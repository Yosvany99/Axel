import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { tool } from 'ai';
import { z } from 'zod';

const execAsync = promisify(exec);

// Simple file-based key-value memory
const MEMORY_FILE = path.resolve(process.cwd(), 'agent_memory.json');

async function readMemoryStore(): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(MEMORY_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function writeMemoryStore(store: Record<string, string>): Promise<void> {
  await fs.writeFile(MEMORY_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export function getTools() {
  return {
    run_command: tool({
      description: 'Execute a shell command. Returns stdout and stderr. Timeout: 30s.',
      parameters: z.object({
        command: z.string().describe('Shell command to execute'),
        cwd: z.string().optional().describe('Working directory (defaults to project root)')
      }),
      execute: async ({ command, cwd }) => {
        try {
          const safeCwd = cwd ? path.resolve(cwd) : process.cwd();
          // Safety: prevent infinite pings
          const safeCmd = /^ping\s/.test(command) && !command.includes('-c ') && !command.includes('-n ')
            ? `${command} -c 4`
            : command;

          const { stdout, stderr } = await execAsync(safeCmd, {
            cwd: safeCwd,
            timeout: 30000
          });

          const parts: string[] = [];
          if (stdout.trim()) parts.push(`STDOUT:\n${stdout.trim()}`);
          if (stderr.trim()) parts.push(`STDERR:\n${stderr.trim()}`);
          return parts.join('\n') || '(no output)';
        } catch (err: any) {
          return `ERROR: ${err.message}`;
        }
      }
    }),

    read_file: tool({
      description: 'Read the contents of a file.',
      parameters: z.object({
        path: z.string().describe('File path relative to project root')
      }),
      execute: async ({ path: filePath }) => {
        try {
          const abs = path.resolve(process.cwd(), filePath);
          return await fs.readFile(abs, 'utf-8');
        } catch (err: any) {
          return `ERROR: ${err.message}`;
        }
      }
    }),

    write_file: tool({
      description: 'Write content to a file. Creates parent directories if needed.',
      parameters: z.object({
        path: z.string().describe('File path relative to project root'),
        content: z.string().describe('Content to write')
      }),
      execute: async ({ path: filePath, content }) => {
        try {
          const abs = path.resolve(process.cwd(), filePath);
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, content, 'utf-8');
          return `Written ${content.length} chars to ${filePath}`;
        } catch (err: any) {
          return `ERROR: ${err.message}`;
        }
      }
    }),

    list_directory: tool({
      description: 'List files and directories at a path.',
      parameters: z.object({
        path: z.string().optional().describe('Directory path (defaults to project root)')
      }),
      execute: async ({ path: dirPath = '.' }) => {
        try {
          const abs = path.resolve(process.cwd(), dirPath);
          const items = await fs.readdir(abs, { withFileTypes: true });
          return items
            .map(i => `${i.isDirectory() ? '📁' : '📄'} ${i.name}`)
            .join('\n');
        } catch (err: any) {
          return `ERROR: ${err.message}`;
        }
      }
    }),

    search_web: tool({
      description: 'Search the web for information using Serper API.',
      parameters: z.object({
        query: z.string().describe('Search query')
      }),
      execute: async ({ query }) => {
        const key = process.env.SERPER_API_KEY;
        if (!key) return `Web search unavailable (SERPER_API_KEY not set). Query was: "${query}"`;
        try {
          const res = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: query, num: 5 })
          });
          const data: any = await res.json();
          const results = (data.organic || []).slice(0, 5).map((r: any) =>
            `**${r.title}**\n${r.snippet}\n${r.link}`
          );
          return results.join('\n\n') || 'No results found.';
        } catch (err: any) {
          return `Search error: ${err.message}`;
        }
      }
    }),

    fetch_url: tool({
      description: 'Fetch the text content of a URL.',
      parameters: z.object({
        url: z.string().describe('URL to fetch')
      }),
      execute: async ({ url }) => {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
          const text = await res.text();
          const truncated = text.length > 8000 ? text.slice(0, 8000) + '\n[truncated]' : text;
          return truncated;
        } catch (err: any) {
          return `Fetch error: ${err.message}`;
        }
      }
    }),

    memory_write: tool({
      description: 'Save a value to persistent memory under a key.',
      parameters: z.object({
        key: z.string().describe('Memory key'),
        value: z.string().describe('Value to store (use JSON string for objects)')
      }),
      execute: async ({ key, value }) => {
        const store = await readMemoryStore();
        store[key] = value;
        await writeMemoryStore(store);
        return `Saved: ${key}`;
      }
    }),

    memory_read: tool({
      description: 'Read a value from persistent memory.',
      parameters: z.object({
        key: z.string().describe('Memory key to read')
      }),
      execute: async ({ key }) => {
        const store = await readMemoryStore();
        return store[key] ?? `Key "${key}" not found in memory.`;
      }
    }),

    memory_list: tool({
      description: 'List all keys stored in persistent memory.',
      parameters: z.object({}),
      execute: async () => {
        const store = await readMemoryStore();
        const keys = Object.keys(store);
        return keys.length ? keys.join('\n') : '(memory is empty)';
      }
    })
  };
}
