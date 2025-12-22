#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { promises as fs } from 'fs';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import minimist from 'minimist';
import { isAbsolute } from 'path';

// Read version from package.json - single source of truth
// Path is '../package.json' because compiled code runs from dist/
const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string; name: string };

// Parse args and handle paths safely
const argv = minimist(process.argv.slice(2));
let memoryPath = argv['memory-path'];

// If a custom path is provided, ensure it's absolute
if (memoryPath && !isAbsolute(memoryPath)) {
    memoryPath = path.resolve(process.cwd(), memoryPath);
}

// Define the base directory for memory files
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Handle memory path - could be a file or directory
let baseMemoryPath: string;
if (memoryPath) {
  // If memory-path points to a .jsonl file, use its directory as the base
  if (memoryPath.endsWith('.jsonl')) {
    baseMemoryPath = path.dirname(memoryPath);
  } else {
    // Otherwise treat it as a directory
    baseMemoryPath = memoryPath;
  }
} else {
  baseMemoryPath = __dirname;
}

// Simple marker to identify our files - prevents writing to unrelated JSONL files
const FILE_MARKER = {
  type: "_aim",
  source: "mcp-knowledge-graph"
};

// Project detection - look for common project markers
// .aim is checked first: if it exists, that's an explicit signal for project-local storage
function findProjectRoot(startDir: string = process.cwd()): string | null {
  const projectMarkers = ['.aim', '.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod'];
  let currentDir = startDir;
  const maxDepth = 5;

  for (let i = 0; i < maxDepth; i++) {
    // Check for project markers
    for (const marker of projectMarkers) {
      if (existsSync(path.join(currentDir, marker))) {
        return currentDir;
      }
    }

    // Move up one directory
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached root directory
      break;
    }
    currentDir = parentDir;
  }

  return null;
}

// Function to get memory file path based on context and optional location override
function getMemoryFilePath(context?: string, location?: 'project' | 'global'): string {
  const filename = context ? `memory-${context}.jsonl` : 'memory.jsonl';
  
  // If location is explicitly specified, use it
  if (location === 'global') {
    return path.join(baseMemoryPath, filename);
  }
  
  if (location === 'project') {
    const projectRoot = findProjectRoot();
    if (projectRoot) {
      const aimDir = path.join(projectRoot, '.aim');
      return path.join(aimDir, filename); // Will create .aim if it doesn't exist
    } else {
      throw new Error('No project detected - cannot use project location');
    }
  }
  
  // Auto-detect logic (existing behavior)
  const projectRoot = findProjectRoot();
  if (projectRoot) {
    const aimDir = path.join(projectRoot, '.aim');
    if (existsSync(aimDir)) {
      return path.join(aimDir, filename);
    }
  }
  
  // Fallback to configured base directory
  return path.join(baseMemoryPath, filename);
}

// We are storing our memory using entities, relations, and observations in a graph structure
interface Entity {
  name: string;
  entityType: string;
  observations: string[];
}

interface Relation {
  from: string;
  to: string;
  relationType: string;
}

interface KnowledgeGraph {
  entities: Entity[];
  relations: Relation[];
}

// Format a knowledge graph as human-readable text
function formatGraphPretty(graph: KnowledgeGraph, context?: string): string {
  const lines: string[] = [];
  const dbName = context || 'default';

  lines.push(`=== ${dbName} database ===`);
  lines.push('');

  // Entities section
  if (graph.entities.length === 0) {
    lines.push('ENTITIES: (none)');
  } else {
    lines.push(`ENTITIES (${graph.entities.length}):`);
    for (const entity of graph.entities) {
      lines.push(`  ${entity.name} [${entity.entityType}]`);
      for (const obs of entity.observations) {
        lines.push(`    - ${obs}`);
      }
    }
  }

  lines.push('');

  // Relations section
  if (graph.relations.length === 0) {
    lines.push('RELATIONS: (none)');
  } else {
    lines.push(`RELATIONS (${graph.relations.length}):`);
    for (const rel of graph.relations) {
      lines.push(`  ${rel.from} --${rel.relationType}--> ${rel.to}`);
    }
  }

  return lines.join('\n');
}

// The KnowledgeGraphManager class contains all operations to interact with the knowledge graph
class KnowledgeGraphManager {
  private async loadGraph(context?: string, location?: 'project' | 'global'): Promise<KnowledgeGraph> {
    const filePath = getMemoryFilePath(context, location);
    
    try {
      const data = await fs.readFile(filePath, "utf-8");
      const lines = data.split("\n").filter(line => line.trim() !== "");
      
      if (lines.length === 0) {
        return { entities: [], relations: [] };
      }
      
      // Check first line for our file marker
      const firstLine = JSON.parse(lines[0]!);
      if (firstLine.type !== "_aim" || firstLine.source !== "mcp-knowledge-graph") {
        throw new Error(`File ${filePath} does not contain required _aim safety marker. This file may not belong to the knowledge graph system. Expected first line: {"type":"_aim","source":"mcp-knowledge-graph"}`);
      }
      
      // Process remaining lines (skip metadata)
      return lines.slice(1).reduce((graph: KnowledgeGraph, line) => {
        const item = JSON.parse(line);
        if (item.type === "entity") graph.entities.push(item as Entity);
        if (item.type === "relation") graph.relations.push(item as Relation);
        return graph;
      }, { entities: [], relations: [] });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as any).code === "ENOENT") {
        // File doesn't exist - we'll create it with metadata on first save
        return { entities: [], relations: [] };
      }
      throw error;
    }
  }

  private async saveGraph(graph: KnowledgeGraph, context?: string, location?: 'project' | 'global'): Promise<void> {
    const filePath = getMemoryFilePath(context, location);
    
    // Write our simple file marker
    
    const lines = [
      JSON.stringify(FILE_MARKER),
      ...graph.entities.map(e => JSON.stringify({ type: "entity", ...e })),
      ...graph.relations.map(r => JSON.stringify({ type: "relation", ...r })),
    ];
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    
    await fs.writeFile(filePath, lines.join("\n"));
  }

  async createEntities(entities: Entity[], context?: string, location?: 'project' | 'global'): Promise<Entity[]> {
    const graph = await this.loadGraph(context, location);
    const newEntities = entities.filter(e => !graph.entities.some(existingEntity => existingEntity.name === e.name));
    graph.entities.push(...newEntities);
    await this.saveGraph(graph, context, location);
    return newEntities;
  }

  async createRelations(relations: Relation[], context?: string, location?: 'project' | 'global'): Promise<Relation[]> {
    const graph = await this.loadGraph(context, location);
    const newRelations = relations.filter(r => !graph.relations.some(existingRelation =>
      existingRelation.from === r.from &&
      existingRelation.to === r.to &&
      existingRelation.relationType === r.relationType
    ));
    graph.relations.push(...newRelations);
    await this.saveGraph(graph, context, location);
    return newRelations;
  }

  async addObservations(observations: { entityName: string; contents: string[] }[], context?: string, location?: 'project' | 'global'): Promise<{ entityName: string; addedObservations: string[] }[]> {
    const graph = await this.loadGraph(context, location);
    const results = observations.map(o => {
      const entity = graph.entities.find(e => e.name === o.entityName);
      if (!entity) {
        throw new Error(`Entity with name ${o.entityName} not found`);
      }
      const newObservations = o.contents.filter(content => !entity.observations.includes(content));
      entity.observations.push(...newObservations);
      return { entityName: o.entityName, addedObservations: newObservations };
    });
    await this.saveGraph(graph, context, location);
    return results;
  }

  async deleteEntities(entityNames: string[], context?: string, location?: 'project' | 'global'): Promise<void> {
    const graph = await this.loadGraph(context, location);
    graph.entities = graph.entities.filter(e => !entityNames.includes(e.name));
    graph.relations = graph.relations.filter(r => !entityNames.includes(r.from) && !entityNames.includes(r.to));
    await this.saveGraph(graph, context, location);
  }

  async deleteObservations(deletions: { entityName: string; observations: string[] }[], context?: string, location?: 'project' | 'global'): Promise<void> {
    const graph = await this.loadGraph(context, location);
    deletions.forEach(d => {
      const entity = graph.entities.find(e => e.name === d.entityName);
      if (entity) {
        entity.observations = entity.observations.filter(o => !d.observations.includes(o));
      }
    });
    await this.saveGraph(graph, context, location);
  }

  async deleteRelations(relations: Relation[], context?: string, location?: 'project' | 'global'): Promise<void> {
    const graph = await this.loadGraph(context, location);
    graph.relations = graph.relations.filter(r => !relations.some(delRelation =>
      r.from === delRelation.from &&
      r.to === delRelation.to &&
      r.relationType === delRelation.relationType
    ));
    await this.saveGraph(graph, context, location);
  }

  async readGraph(context?: string, location?: 'project' | 'global'): Promise<KnowledgeGraph> {
    return this.loadGraph(context, location);
  }

  // Very basic search function
  async searchNodes(query: string, context?: string, location?: 'project' | 'global'): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph(context, location);

    // Filter entities
    const filteredEntities = graph.entities.filter(e =>
      e.name.toLowerCase().includes(query.toLowerCase()) ||
      e.entityType.toLowerCase().includes(query.toLowerCase()) ||
      e.observations.some(o => o.toLowerCase().includes(query.toLowerCase()))
    );

    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));

    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(r =>
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );

    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };

    return filteredGraph;
  }

  async openNodes(names: string[], context?: string, location?: 'project' | 'global'): Promise<KnowledgeGraph> {
    const graph = await this.loadGraph(context, location);

    // Filter entities
    const filteredEntities = graph.entities.filter(e => names.includes(e.name));

    // Create a Set of filtered entity names for quick lookup
    const filteredEntityNames = new Set(filteredEntities.map(e => e.name));

    // Filter relations to only include those between filtered entities
    const filteredRelations = graph.relations.filter(r =>
      filteredEntityNames.has(r.from) && filteredEntityNames.has(r.to)
    );

    const filteredGraph: KnowledgeGraph = {
      entities: filteredEntities,
      relations: filteredRelations,
    };

    return filteredGraph;
  }

  async listDatabases(): Promise<{ project_databases: string[], global_databases: string[], current_location: string }> {
    const result = {
      project_databases: [] as string[],
      global_databases: [] as string[],
      current_location: ""
    };

    // Check project-local .aim directory
    const projectRoot = findProjectRoot();
    if (projectRoot) {
      const aimDir = path.join(projectRoot, '.aim');
      if (existsSync(aimDir)) {
        result.current_location = "project (.aim directory detected)";
        try {
          const files = await fs.readdir(aimDir);
          result.project_databases = files
            .filter(file => file.endsWith('.jsonl'))
            .map(file => file === 'memory.jsonl' ? 'default' : file.replace('memory-', '').replace('.jsonl', ''))
            .sort();
        } catch (error) {
          // Directory exists but can't read - ignore
        }
      } else {
        result.current_location = "global (no .aim directory in project)";
      }
    } else {
      result.current_location = "global (no project detected)";
    }

    // Check global directory
    try {
      const files = await fs.readdir(baseMemoryPath);
      result.global_databases = files
        .filter(file => file.endsWith('.jsonl'))
        .map(file => file === 'memory.jsonl' ? 'default' : file.replace('memory-', '').replace('.jsonl', ''))
        .sort();
    } catch (error) {
      // Directory doesn't exist or can't read
      result.global_databases = [];
    }

    return result;
  }
}

const knowledgeGraphManager = new KnowledgeGraphManager();


// The server instance and tools exposed to AI models
const server = new Server({
  name: pkg.name,
  version: pkg.version,
}, {
  capabilities: {
    tools: {},
  },
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "aim_create_entities",
        description: `Create multiple new entities in the knowledge graph.

AIM (AI Memory) provides persistent memory for AI assistants using a local knowledge graph. The 'aim_' prefix groups all memory tools together.

WHAT'S STORED: Entities (people, projects, concepts), relations between them, and observations (facts about entities).

DATABASES: Use the 'context' parameter to organize memories into separate graphs:
- Leave blank: Uses the master database (default for general information)
- Any name: Creates/uses a named database ('work', 'personal', 'health', 'research', etc.)
- New databases are created automatically - no setup required
- IMPORTANT: Use consistent, simple names - prefer 'work' over 'work-stuff'

STORAGE LOCATIONS: Files are stored as JSONL (e.g., memory.jsonl, memory-work.jsonl):
- Project-local: .aim directory in project root (auto-detected if exists)
- Global: User's configured --memory-path directory
- Use 'location' parameter to override: 'project' or 'global'

RETURNS: Array of created entities.

EXAMPLES:
- Master database (default): aim_create_entities({entities: [{name: "John", entityType: "person", observations: ["Met at conference"]}]})
- Work database: aim_create_entities({context: "work", entities: [{name: "Q4_Project", entityType: "project", observations: ["Due December 2024"]}]})
- Master database in global location: aim_create_entities({location: "global", entities: [{name: "John", entityType: "person", observations: ["Met at conference"]}]})
- Work database in project location: aim_create_entities({context: "work", location: "project", entities: [{name: "Q4_Project", entityType: "project", observations: ["Due December 2024"]}]})`,
        inputSchema: {
          type: "object",
          properties: {
            context: {
              type: "string",
              description: "Optional memory context. Defaults to master database if not specified. Use any descriptive name ('work', 'personal', 'health', 'basket-weaving', etc.) - new contexts created automatically."
            },
            location: {
              type: "string",
              enum: ["project", "global"],
              description: "Optional storage location override. 'project' forces project-local .aim directory, 'global' forces global directory. If not specified, uses automatic detection."
            },
            entities: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", description: "The name of the entity" },
                  entityType: { type: "string", description: "The type of the entity" },
                  observations: {
                    type: "array",
                    items: { type: "string" },
                    description: "An array of observation contents associated with the entity"
                  },
                },
                required: ["name", "entityType", "observations"],
              },
            },
          },
          required: ["entities"],
        },
      },
      {
        name: "aim_create_relations",
        description: `Create relations (edges) between entities in the knowledge graph.

RELATION STRUCTURE: Each relation has 'from' (subject), 'relationType' (verb), and 'to' (object).
- Use active voice verbs: "manages", "works_at", "knows", "attended", "created"
- Read as: "from relationType to" (e.g., "Alice manages Q4_Project")
- Avoid passive: use "manages" not "is_managed_by"

IMPORTANT: Both 'from' and 'to' entities must already exist in the same database.

RETURNS: Array of created relations (duplicates are ignored).

DATABASE: Relations are created in the specified 'context' database, or master database if not specified.

EXAMPLES:
- aim_create_relations({relations: [{from: "John", to: "TechConf2024", relationType: "attended"}]})
- aim_create_relations({context: "work", relations: [{from: "Alice", to: "Q4_Project", relationType: "manages"}]})
- Multiple: aim_create_relations({relations: [{from: "John", to: "Alice", relationType: "knows"}, {from: "John", to: "Acme_Corp", relationType: "works_at"}]})`,
        inputSchema: {
          type: "object",
          properties: {
            context: {
              type: "string",
              description: "Optional memory context. Relations will be created in the specified context's knowledge graph."
            },
            location: {
              type: "string",
              enum: ["project", "global"],
              description: "Optional storage location override. 'project' forces project-local .aim directory, 'global' forces global directory. If not specified, uses automatic detection."
            },
            relations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string", description: "The name of the entity where the relation starts" },
                  to: { type: "string", description: "The name of the entity where the relation ends" },
                  relationType: { type: "string", description: "The type of the relation" },
                },
                required: ["from", "to", "relationType"],
              },
            },
          },
          required: ["relations"],
        },
      },
      {
        name: "aim_add_observations",
        description: `Add new observations (facts) to existing entities.

IMPORTANT: Entity must already exist - use aim_create_entities first. Throws error if entity not found.

RETURNS: Array of {entityName, addedObservations} showing what was added (duplicates are ignored).

DATABASE: Adds to entities in the specified 'context' database, or master database if not specified.

EXAMPLES:
- aim_add_observations({observations: [{entityName: "John", contents: ["Lives in Seattle", "Works in tech"]}]})
- aim_add_observations({context: "work", observations: [{entityName: "Q4_Project", contents: ["Behind schedule", "Need more resources"]}]})`,
        inputSchema: {
          type: "object",
          properties: {
            context: {
              type: "string",
              description: "Optional memory context. Observations will be added to entities in the specified context's knowledge graph."
            },
            location: {
              type: "string",
              enum: ["project", "global"],
              description: "Optional storage location override. 'project' forces project-local .aim directory, 'global' forces global directory. If not specified, uses automatic detection."
            },
            observations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entityName: { type: "string", description: "The name of the entity to add the observations to" },
                  contents: {
                    type: "array",
                    items: { type: "string" },
                    description: "An array of observation contents to add"
                  },
                },
                required: ["entityName", "contents"],
              },
            },
          },
          required: ["observations"],
        },
      },
      {
        name: "aim_delete_entities",
        description: `Delete multiple entities and their associated relations from the knowledge graph.

DATABASE SELECTION: Entities are deleted from the specified database's knowledge graph.

LOCATION OVERRIDE: Use the 'location' parameter to force deletion from 'project' (.aim directory) or 'global' (configured directory). Leave blank for auto-detection.

EXAMPLES:
- Master database (default): aim_delete_entities({entityNames: ["OldProject"]})
- Work database: aim_delete_entities({context: "work", entityNames: ["CompletedTask", "CancelledMeeting"]})
- Master database in global location: aim_delete_entities({location: "global", entityNames: ["OldProject"]})
- Personal database in project location: aim_delete_entities({context: "personal", location: "project", entityNames: ["ExpiredReminder"]})`,
        inputSchema: {
          type: "object",
          properties: {
            context: {
              type: "string",
              description: "Optional memory context. Entities will be deleted from the specified context's knowledge graph."
            },
            location: {
              type: "string",
              enum: ["project", "global"],
              description: "Optional storage location override. 'project' forces project-local .aim directory, 'global' forces global directory. If not specified, uses automatic detection."
            },
            entityNames: {
              type: "array",
              items: { type: "string" },
              description: "An array of entity names to delete"
            },
          },
          required: ["entityNames"],
        },
      },
      {
        name: "aim_delete_observations",
        description: `Delete specific observations from entities in the knowledge graph.

DATABASE SELECTION: Observations are deleted from entities within the specified database's knowledge graph.

LOCATION OVERRIDE: Use the 'location' parameter to force deletion from 'project' (.aim directory) or 'global' (configured directory). Leave blank for auto-detection.

EXAMPLES:
- Master database (default): aim_delete_observations({deletions: [{entityName: "John", observations: ["Outdated info"]}]})
- Work database: aim_delete_observations({context: "work", deletions: [{entityName: "Project", observations: ["Old deadline"]}]})
- Master database in global location: aim_delete_observations({location: "global", deletions: [{entityName: "John", observations: ["Outdated info"]}]})
- Health database in project location: aim_delete_observations({context: "health", location: "project", deletions: [{entityName: "Exercise", observations: ["Injured knee"]}]})`,
        inputSchema: {
          type: "object",
          properties: {
            context: {
              type: "string",
              description: "Optional memory context. Observations will be deleted from entities in the specified context's knowledge graph."
            },
            location: {
              type: "string",
              enum: ["project", "global"],
              description: "Optional storage location override. 'project' forces project-local .aim directory, 'global' forces global directory. If not specified, uses automatic detection."
            },
            deletions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  entityName: { type: "string", description: "The name of the entity containing the observations" },
                  observations: {
                    type: "array",
                    items: { type: "string" },
                    description: "An array of observations to delete"
                  },
                },
                required: ["entityName", "observations"],
              },
            },
          },
          required: ["deletions"],
        },
      },
      {
        name: "aim_delete_relations",
        description: `Delete multiple relations from the knowledge graph.

DATABASE SELECTION: Relations are deleted from the specified database's knowledge graph.

LOCATION OVERRIDE: Use the 'location' parameter to force deletion from 'project' (.aim directory) or 'global' (configured directory). Leave blank for auto-detection.

EXAMPLES:
- Master database (default): aim_delete_relations({relations: [{from: "John", to: "OldCompany", relationType: "worked_at"}]})
- Work database: aim_delete_relations({context: "work", relations: [{from: "Alice", to: "CancelledProject", relationType: "manages"}]})
- Master database in global location: aim_delete_relations({location: "global", relations: [{from: "John", to: "OldCompany", relationType: "worked_at"}]})
- Personal database in project location: aim_delete_relations({context: "personal", location: "project", relations: [{from: "Me", to: "OldHobby", relationType: "enjoys"}]})`,
        inputSchema: {
          type: "object",
          properties: {
            context: {
              type: "string",
              description: "Optional memory context. Relations will be deleted from the specified context's knowledge graph."
            },
            location: {
              type: "string",
              enum: ["project", "global"],
              description: "Optional storage location override. 'project' forces project-local .aim directory, 'global' forces global directory. If not specified, uses automatic detection."
            },
            relations: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  from: { type: "string", description: "The name of the entity where the relation starts" },
                  to: { type: "string", description: "The name of the entity where the relation ends" },
                  relationType: { type: "string", description: "The type of the relation" },
                },
                required: ["from", "to", "relationType"],
              },
              description: "An array of relations to delete"
            },
          },
          required: ["relations"],
        },
      },
      {
        name: "aim_read_graph",
        description: `Read the entire knowledge graph.

FORMAT OPTIONS:
- "json" (default): Structured JSON for programmatic use
- "pretty": Human-readable text format

DATABASE: Reads from the specified 'context' database, or master database if not specified.

EXAMPLES:
- aim_read_graph({}) - JSON format
- aim_read_graph({format: "pretty"}) - Human-readable
- aim_read_graph({context: "work", format: "pretty"}) - Work database, pretty`,
        inputSchema: {
          type: "object",
          properties: {
            context: {
              type: "string",
              description: "Optional memory context. Reads from the specified context's knowledge graph or master database if not specified."
            },
            location: {
              type: "string",
              enum: ["project", "global"],
              description: "Optional storage location override. 'project' for .aim directory, 'global' for configured directory."
            },
            format: {
              type: "string",
              enum: ["json", "pretty"],
              description: "Output format. 'json' (default) for structured data, 'pretty' for human-readable text."
            }
          },
        },
      },
      {
        name: "aim_search_nodes",
        description: `Fuzzy search for entities in the knowledge graph. Use this when you don't know exact entity names.

WHAT IT SEARCHES: Matches query (case-insensitive) against:
- Entity names (e.g., "John" matches "John_Smith")
- Entity types (e.g., "person" matches all person entities)
- Observation content (e.g., "Seattle" matches entities with Seattle in their observations)

VS aim_open_nodes: Use search when you need fuzzy matching. Use open_nodes when you know exact entity names.

FORMAT OPTIONS:
- "json" (default): Structured JSON for programmatic use
- "pretty": Human-readable text format

EXAMPLES:
- aim_search_nodes({query: "John"}) - JSON format
- aim_search_nodes({query: "project", format: "pretty"}) - Human-readable
- aim_search_nodes({context: "work", query: "Shane", format: "pretty"})`,
        inputSchema: {
          type: "object",
          properties: {
            context: {
              type: "string",
              description: "Optional database name. Searches within this database or master database if not specified."
            },
            location: {
              type: "string",
              enum: ["project", "global"],
              description: "Optional storage location override. 'project' for .aim directory, 'global' for configured directory."
            },
            query: { type: "string", description: "Search text to match against entity names, entity types, and observation content (case-insensitive)" },
            format: {
              type: "string",
              enum: ["json", "pretty"],
              description: "Output format. 'json' (default) for structured data, 'pretty' for human-readable text."
            }
          },
          required: ["query"],
        },
      },
      {
        name: "aim_open_nodes",
        description: `Retrieve specific entities by exact name. Use this when you know the exact entity names you want.

VS aim_search_nodes: Use open_nodes for exact name lookup. Use search_nodes when you need fuzzy matching or don't know exact names.

RETURNS: Requested entities and relations between them. Non-existent names are silently ignored.

FORMAT OPTIONS:
- "json" (default): Structured JSON for programmatic use
- "pretty": Human-readable text format

EXAMPLES:
- aim_open_nodes({names: ["John", "TechConf2024"]}) - JSON format
- aim_open_nodes({names: ["Shane"], format: "pretty"}) - Human-readable
- aim_open_nodes({context: "work", names: ["Q4_Project"], format: "pretty"})`,
        inputSchema: {
          type: "object",
          properties: {
            context: {
              type: "string",
              description: "Optional memory context. Retrieves entities from the specified context's knowledge graph or master database if not specified."
            },
            location: {
              type: "string",
              enum: ["project", "global"],
              description: "Optional storage location override. 'project' for .aim directory, 'global' for configured directory."
            },
            names: {
              type: "array",
              items: { type: "string" },
              description: "An array of entity names to retrieve",
            },
            format: {
              type: "string",
              enum: ["json", "pretty"],
              description: "Output format. 'json' (default) for structured data, 'pretty' for human-readable text."
            }
          },
          required: ["names"],
        },
      },
      {
        name: "aim_list_databases",
        description: `List all available memory databases and show current storage location.

DATABASE TYPES:
- "default": The master database (memory.jsonl) - used when no context is specified
- Named databases: Created via context parameter (e.g., "work" -> memory-work.jsonl)

RETURNS: {project_databases: [...], global_databases: [...], current_location: "..."}
- project_databases: Databases in .aim directory (if project detected)
- global_databases: Databases in global --memory-path directory
- current_location: Where operations will default to

Use this to discover what databases exist before querying them.

EXAMPLES:
- aim_list_databases() - Shows all available databases and current storage location`,
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (!args) {
    throw new Error(`No arguments provided for tool: ${name}`);
  }

  switch (name) {
    case "aim_create_entities":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.createEntities(args.entities as Entity[], args.context as string, args.location as 'project' | 'global'), null, 2) }] };
    case "aim_create_relations":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.createRelations(args.relations as Relation[], args.context as string, args.location as 'project' | 'global'), null, 2) }] };
    case "aim_add_observations":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.addObservations(args.observations as { entityName: string; contents: string[] }[], args.context as string, args.location as 'project' | 'global'), null, 2) }] };
    case "aim_delete_entities":
      await knowledgeGraphManager.deleteEntities(args.entityNames as string[], args.context as string, args.location as 'project' | 'global');
      return { content: [{ type: "text", text: "Entities deleted successfully" }] };
    case "aim_delete_observations":
      await knowledgeGraphManager.deleteObservations(args.deletions as { entityName: string; observations: string[] }[], args.context as string, args.location as 'project' | 'global');
      return { content: [{ type: "text", text: "Observations deleted successfully" }] };
    case "aim_delete_relations":
      await knowledgeGraphManager.deleteRelations(args.relations as Relation[], args.context as string, args.location as 'project' | 'global');
      return { content: [{ type: "text", text: "Relations deleted successfully" }] };
    case "aim_read_graph": {
      const graph = await knowledgeGraphManager.readGraph(args.context as string, args.location as 'project' | 'global');
      const output = args.format === 'pretty'
        ? formatGraphPretty(graph, args.context as string)
        : JSON.stringify(graph, null, 2);
      return { content: [{ type: "text", text: output }] };
    }
    case "aim_search_nodes": {
      const graph = await knowledgeGraphManager.searchNodes(args.query as string, args.context as string, args.location as 'project' | 'global');
      const output = args.format === 'pretty'
        ? formatGraphPretty(graph, args.context as string)
        : JSON.stringify(graph, null, 2);
      return { content: [{ type: "text", text: output }] };
    }
    case "aim_open_nodes": {
      const graph = await knowledgeGraphManager.openNodes(args.names as string[], args.context as string, args.location as 'project' | 'global');
      const output = args.format === 'pretty'
        ? formatGraphPretty(graph, args.context as string)
        : JSON.stringify(graph, null, 2);
      return { content: [{ type: "text", text: output }] };
    }
    case "aim_list_databases":
      return { content: [{ type: "text", text: JSON.stringify(await knowledgeGraphManager.listDatabases(), null, 2) }] };
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Knowledge Graph MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
