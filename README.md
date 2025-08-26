# MCP Knowledge Graph

**Persistent memory for AI models through a local knowledge graph.**

Store and retrieve information across conversations using entities, relations, and observations. Works with Claude Code/Desktop and any MCP-compatible AI platform.

## Why ".aim" and "aim_" prefixes?

AIM stands for **AI Memory** - the core concept of this knowledge graph system. The three AIM elements provide clear organization and safety:

- **`.aim` directories**: Keep AI memory files organized and easily identifiable
- **`aim_` tool prefixes**: Group related memory functions together in multi-tool setups
- **`_aim` safety markers**: Each memory file starts with `{"type":"_aim","source":"mcp-knowledge-graph"}` to prevent accidental overwrites of unrelated JSONL files

This consistent AIM naming makes it obvious which directories, tools, and files belong to our AI memory system.

## Storage Logic

**File Location Priority:**

1. **Project with `.aim`** - Uses `.aim/memory.jsonl` (project-local)
2. **No project/no .aim** - Uses configured global directory
3. **Contexts** - Adds suffix: `memory-work.jsonl`, `memory-personal.jsonl`

**Safety System:**

- Every memory file starts with `{"type":"_aim","source":"mcp-knowledge-graph"}`
- System refuses to write to files without this marker
- Prevents accidental overwrite of unrelated JSONL files

## Master Database Concept

**The master database is your primary memory store** - used by default when no specific database is requested. It's always named `default` in listings and stored as `memory.jsonl`.

- **Default Behavior**: All memory operations use the master database unless you specify a different one
- **Always Available**: Exists in both project-local and global locations
- **Primary Storage**: Your main knowledge graph that persists across all conversations
- **Named Databases**: Optional additional databases (`work`, `personal`, `health`) for organizing specific topics

## Key Features

- **Master Database**: Primary memory store used by default for all operations
- **Multiple Databases**: Optional named databases for organizing memories by topic
- **Project Detection**: Automatic project-local memory using `.aim` directories
- **Location Override**: Force operations to use project or global storage
- **Safe Operations**: Built-in protection against overwriting unrelated files
- **Database Discovery**: List all available databases in both locations

## Quick Start

### Global Memory (Recommended)

Add to your `claude_desktop_config.json` or `.claude.json`:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-knowledge-graph",
        "--memory-path",
        "/Users/yourusername/.aim/"
      ]
    }
  }
}
```

This creates memory files in your specified directory:

- `memory.jsonl` - **Master Database** (default for all operations)
- `memory-work.jsonl` - Work database
- `memory-personal.jsonl` - Personal database
- etc.

### Project-Local Memory

In any project, create a `.aim` directory:

```bash
mkdir .aim
```

Now memory tools automatically use `.aim/memory.jsonl` (project-local **master database**) instead of global storage when run from this project.

## How AI Uses Databases

Once configured, AI models use the **master database by default** or can specify named databases with a `context` parameter. New databases are created automatically - no setup required:

```json
// Master Database (default - no context needed)
aim_create_entities({
  entities: [{
    name: "John_Doe",
    entityType: "person",
    observations: ["Met at conference"]
  }]
})

// Work database
aim_create_entities({
  context: "work",
  entities: [{
    name: "Q4_Project",
    entityType: "project",
    observations: ["Due December 2024"]
  }]
})

// Personal database
aim_create_entities({
  context: "personal",
  entities: [{
    name: "Mom",
    entityType: "person",
    observations: ["Birthday March 15th"]
  }]
})

// Master database in specific location
aim_create_entities({
  location: "global",
  entities: [{
    name: "Important_Info",
    entityType: "reference",
    observations: ["Stored in global master database"]
  }]
})
```

## File Organization

**Global Setup:**

```tree
/Users/yourusername/.aim/
├── memory.jsonl           # Master Database (default)
├── memory-work.jsonl      # Work database
├── memory-personal.jsonl  # Personal database
└── memory-health.jsonl    # Health database
```

**Project Setup:**

```tree
my-project/
├── .aim/
│   ├── memory.jsonl       # Project Master Database (default)
│   └── memory-work.jsonl  # Project Work database
└── src/
```

## Available Tools

- `aim_create_entities` - Add new people, projects, events
- `aim_create_relations` - Link entities together
- `aim_add_observations` - Add facts to existing entities
- `aim_search_nodes` - Find information by keyword
- `aim_read_graph` - View entire memory
- `aim_open_nodes` - Retrieve specific entities by name
- `aim_list_databases` - Show all available databases and current location
- `aim_delete_entities` - Remove entities
- `aim_delete_observations` - Remove specific facts
- `aim_delete_relations` - Remove connections

### Parameters

- `context` (optional) - Specify named database (`work`, `personal`, etc.). Defaults to **master database**
- `location` (optional) - Force `project` or `global` storage location. Defaults to auto-detection

## Database Discovery

Use `aim_list_databases` to see all available databases:

```json
{
  "project_databases": [
    "default",      // Master Database (project-local)
    "project-work"  // Named database
  ],
  "global_databases": [
    "default",      // Master Database (global)
    "work",
    "personal",
    "health"
  ],
  "current_location": "project (.aim directory detected)"
}
```

**Key Points:**

- **"default"** = Master Database in both locations
- **Current location** shows whether you're using project or global storage
- **Master database exists everywhere** - it's your primary memory store
- **Named databases** are optional additions for specific topics

## Configuration Examples

**Important:** Always specify `--memory-path` to control where your memory files are stored.

**Home directory:**

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-knowledge-graph",
        "--memory-path",
        "/Users/yourusername/.aim"
      ]
    }
  }
}
```

**Custom location (e.g., Dropbox):**

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-knowledge-graph",
        "--memory-path",
        "/Users/yourusername/Dropbox/.aim"
      ]
    }
  }
}
```

**Auto-approve all operations:**

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-knowledge-graph",
        "--memory-path",
        "/Users/yourusername/.aim"
      ],
      "autoapprove": [
        "aim_create_entities",
        "aim_create_relations",
        "aim_add_observations",
        "aim_search_nodes",
        "aim_read_graph",
        "aim_open_nodes",
        "aim_list_databases"
      ]
    }
  }
}
```

## Troubleshooting

**"File does not contain required _aim safety marker" error:**

- The file may not belong to this system
- Manual JSONL files need `{"type":"_aim","source":"mcp-knowledge-graph"}` as first line
- If you created the file manually, add the `_aim` marker or delete and let the system recreate it

**Memories going to unexpected locations:**

- Check if you're in a project directory with `.aim` folder (uses project-local storage)
- Otherwise uses the configured global `--memory-path` directory
- Use `aim_list_databases` to see all available databases and current location
- Use `ls .aim/` or `ls /Users/yourusername/.aim/` to see your memory files

**Too many similar databases:**

- AI models try to use consistent names, but may create variations
- Manually delete unwanted database files if needed
- Encourage AI to use simple, consistent database names
- **Remember**: Master database is always available as the default - named databases are optional

## Requirements

- Node.js 18+
- MCP-compatible AI platform

## License

MIT
