import fs from 'fs/promises';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { tool } from 'ai';
import { z } from 'zod';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';

const execAsync = promisify(exec);
const MEMORY_FILE = path.resolve(process.cwd(), 'agent_memory.json');

async function readMemoryStore(): Promise<Record<string, string>> {
  try { return JSON.parse(await fs.readFile(MEMORY_FILE, 'utf-8')); }
  catch { return {}; }
}
async function writeMemoryStore(store: Record<string, string>) {
  await fs.writeFile(MEMORY_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export function getTools() {
  return {

    // ── SHELL ─────────────────────────────────────────────
    run_command: tool({
      description: 'Execute a shell command. Returns stdout/stderr. Timeout: 60s. Use for any system operation.',
      parameters: z.object({
        command: z.string().describe('Shell command'),
        cwd: z.string().optional().describe('Working directory'),
        timeout: z.number().optional().describe('Timeout in ms (default 60000)')
      }),
      execute: async ({ command, cwd, timeout = 60000 }) => {
        try {
          const safeCwd = cwd ? path.resolve(cwd) : process.cwd();
          const safeCmd = /^ping\s/.test(command) && !command.includes('-c ') ? `${command} -c 4` : command;
          const { stdout, stderr } = await execAsync(safeCmd, { cwd: safeCwd, timeout });
          const parts: string[] = [];
          if (stdout.trim()) parts.push(`STDOUT:\n${stdout.trim()}`);
          if (stderr.trim()) parts.push(`STDERR:\n${stderr.trim()}`);
          return parts.join('\n') || '(no output)';
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    run_script: tool({
      description: 'Write and execute a script (bash, python, node). Returns output.',
      parameters: z.object({
        language: z.enum(['bash', 'python3', 'node']),
        code: z.string().describe('Script content'),
        timeout: z.number().optional().describe('Timeout ms (default 60000)')
      }),
      execute: async ({ language, code, timeout = 60000 }) => {
        const ext = { bash: 'sh', python3: 'py', node: 'js' }[language];
        const tmpFile = path.join(os.tmpdir(), `agent_script_${Date.now()}.${ext}`);
        try {
          await fs.writeFile(tmpFile, code, 'utf-8');
          const { stdout, stderr } = await execAsync(`${language} ${tmpFile}`, { timeout });
          return [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || '(no output)';
        } catch (err: any) { return `ERROR: ${err.message}`; }
        finally { fs.unlink(tmpFile).catch(() => {}); }
      }
    }),

    // ── PROCESOS ──────────────────────────────────────────
    list_processes: tool({
      description: 'List running processes. Filter by process name optionally.',
      parameters: z.object({ name: z.string().optional().describe('Filter by process name') }),
      execute: async ({ name: filter }) => {
        try {
          const cmd = filter ? `ps aux | grep "${filter}" | grep -v grep` : 'ps aux --sort=-%cpu | head -30';
          const { stdout } = await execAsync(cmd);
          return stdout.trim() || 'No processes found';
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    kill_process: tool({
      description: 'Kill a process by PID or name.',
      parameters: z.object({
        target: z.string().describe('PID number or process name'),
        force: z.boolean().optional().describe('Use SIGKILL (default SIGTERM)')
      }),
      execute: async ({ target, force = false }) => {
        try {
          const isNum = /^\d+$/.test(target);
          const cmd = isNum
            ? `kill ${force ? '-9' : ''} ${target}`
            : `pkill ${force ? '-9' : ''} ${target}`;
          await execAsync(cmd);
          return `Killed: ${target}`;
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    // ── SISTEMA ───────────────────────────────────────────
    system_info: tool({
      description: 'Get system information: CPU, RAM, disk, network, OS.',
      parameters: z.object({}),
      execute: async () => {
        try {
          const [cpu, mem, disk, net] = await Promise.all([
            execAsync('top -bn1 | grep "Cpu(s)"').then(r => r.stdout.trim()),
            execAsync('free -h').then(r => r.stdout.trim()),
            execAsync('df -h /').then(r => r.stdout.trim()),
            execAsync('ip addr show | grep "inet " | head -5').then(r => r.stdout.trim()),
          ]);
          return `OS: ${os.platform()} ${os.release()}\nHostname: ${os.hostname()}\nUptime: ${Math.floor(os.uptime()/3600)}h\n\nCPU:\n${cpu}\n\nMemory:\n${mem}\n\nDisk:\n${disk}\n\nNetwork:\n${net}`;
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    get_env: tool({
      description: 'Read environment variables.',
      parameters: z.object({ key: z.string().optional().describe('Specific key, or omit for all') }),
      execute: async ({ key }) => {
        if (key) return process.env[key] ?? `${key} not set`;
        return Object.entries(process.env).map(([k, v]) => `${k}=${v}`).join('\n');
      }
    }),

    set_env: tool({
      description: 'Set an environment variable for this session.',
      parameters: z.object({ key: z.string(), value: z.string() }),
      execute: async ({ key, value }) => {
        process.env[key] = value;
        return `Set ${key}=${value}`;
      }
    }),

    // ── ARCHIVOS ──────────────────────────────────────────
    read_file: tool({
      description: 'Read file contents. Supports text files.',
      parameters: z.object({
        path: z.string(),
        start_line: z.number().optional(),
        end_line: z.number().optional()
      }),
      execute: async ({ path: filePath, start_line, end_line }) => {
        try {
          const abs = path.resolve(process.cwd(), filePath);
          const content = await fs.readFile(abs, 'utf-8');
          if (start_line !== undefined) {
            const lines = content.split('\n');
            return lines.slice((start_line - 1) || 0, end_line).join('\n');
          }
          return content.length > 50000 ? content.slice(0, 50000) + '\n[TRUNCATED]' : content;
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    write_file: tool({
      description: 'Write content to a file. Creates parent dirs if needed.',
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path: filePath, content }) => {
        try {
          const abs = path.resolve(process.cwd(), filePath);
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, content, 'utf-8');
          return `Written ${content.length} chars to ${filePath}`;
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    append_file: tool({
      description: 'Append content to an existing file.',
      parameters: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path: filePath, content }) => {
        try {
          const abs = path.resolve(process.cwd(), filePath);
          await fs.appendFile(abs, content, 'utf-8');
          return `Appended ${content.length} chars to ${filePath}`;
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    delete_file: tool({
      description: 'Delete a file or directory.',
      parameters: z.object({
        path: z.string(),
        recursive: z.boolean().optional().describe('Delete directory recursively')
      }),
      execute: async ({ path: filePath, recursive = false }) => {
        try {
          const abs = path.resolve(process.cwd(), filePath);
          await fs.rm(abs, { recursive, force: true });
          return `Deleted: ${filePath}`;
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    move_file: tool({
      description: 'Move or rename a file/directory.',
      parameters: z.object({ from: z.string(), to: z.string() }),
      execute: async ({ from, to }) => {
        try {
          await fs.rename(path.resolve(from), path.resolve(to));
          return `Moved ${from} → ${to}`;
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    copy_file: tool({
      description: 'Copy a file.',
      parameters: z.object({ from: z.string(), to: z.string() }),
      execute: async ({ from, to }) => {
        try {
          await fs.copyFile(path.resolve(from), path.resolve(to));
          return `Copied ${from} → ${to}`;
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    list_directory: tool({
      description: 'List files and directories.',
      parameters: z.object({
        path: z.string().optional(),
        recursive: z.boolean().optional()
      }),
      execute: async ({ path: dirPath = '.', recursive = false }) => {
        try {
          const abs = path.resolve(process.cwd(), dirPath);
          if (recursive) {
            const { stdout } = await execAsync(`find "${abs}" -maxdepth 4 | head -200`);
            return stdout.trim();
          }
          const items = await fs.readdir(abs, { withFileTypes: true });
          return items.map(i => `${i.isDirectory() ? '📁' : '📄'} ${i.name}`).join('\n');
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    search_files: tool({
      description: 'Search for text inside files (grep) or find files by name.',
      parameters: z.object({
        pattern: z.string().describe('Text or filename pattern to search'),
        directory: z.string().optional().describe('Directory to search in'),
        type: z.enum(['content', 'filename']).optional().describe('Search in file content or filenames')
      }),
      execute: async ({ pattern, directory = '.', type = 'content' }) => {
        try {
          const cmd = type === 'filename'
            ? `find ${directory} -name "*${pattern}*" 2>/dev/null | head -50`
            : `grep -r --include="*" -l "${pattern}" ${directory} 2>/dev/null | head -20 && grep -r -n "${pattern}" ${directory} 2>/dev/null | head -50`;
          const { stdout } = await execAsync(cmd);
          return stdout.trim() || 'No results found';
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    // ── RED ───────────────────────────────────────────────
    http_request: tool({
      description: 'Make an HTTP/HTTPS request. GET, POST, PUT, DELETE, etc.',
      parameters: z.object({
        url: z.string(),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).optional(),
        headers: z.record(z.string()).optional(),
        body: z.string().optional()
      }),
      execute: async ({ url, method = 'GET', headers = {}, body }) => {
        try {
          const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            body: body || undefined,
            signal: AbortSignal.timeout(15000)
          });
          const text = await res.text();
          const preview = text.length > 5000 ? text.slice(0, 5000) + '\n[TRUNCATED]' : text;
          return `Status: ${res.status}\n${preview}`;
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    fetch_url: tool({
      description: 'Fetch and return the text content of a URL.',
      parameters: z.object({ url: z.string() }),
      execute: async ({ url }) => {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!res.ok) return `HTTP ${res.status}: ${res.statusText}`;
          const text = await res.text();
          return text.length > 10000 ? text.slice(0, 10000) + '\n[TRUNCATED]' : text;
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    search_web: tool({
      description: 'Search the web. Uses Serper API if key set, else fetches DuckDuckGo.',
      parameters: z.object({ query: z.string() }),
      execute: async ({ query }) => {
        const key = process.env.SERPER_API_KEY;
        if (key) {
          try {
            const res = await fetch('https://google.serper.dev/search', {
              method: 'POST',
              headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
              body: JSON.stringify({ q: query, num: 8 })
            });
            const data: any = await res.json();
            return (data.organic || []).slice(0, 8).map((r: any) =>
              `**${r.title}**\n${r.snippet}\n${r.link}`
            ).join('\n\n') || 'No results';
          } catch (err: any) { return `Search error: ${err.message}`; }
        }
        // Fallback: DuckDuckGo instant answers
        try {
          const res = await fetch(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1`);
          const data: any = await res.json();
          const results = [data.AbstractText, ...(data.RelatedTopics || []).slice(0, 5).map((t: any) => t.Text)].filter(Boolean);
          return results.join('\n\n') || 'No results (add SERPER_API_KEY for better search)';
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    // ── SERVICIOS ─────────────────────────────────────────
    manage_service: tool({
      description: 'Manage systemd services: start, stop, restart, status, enable, disable.',
      parameters: z.object({
        service: z.string(),
        action: z.enum(['start', 'stop', 'restart', 'status', 'enable', 'disable'])
      }),
      execute: async ({ service, action }) => {
        try {
          const { stdout, stderr } = await execAsync(`sudo systemctl ${action} ${service}`);
          return stdout.trim() || stderr.trim() || 'Done';
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

    // ── MEMORIA ───────────────────────────────────────────
    memory_write: tool({
      description: 'Save a value to persistent memory.',
      parameters: z.object({ key: z.string(), value: z.string() }),
      execute: async ({ key, value }) => {
        const store = await readMemoryStore();
        store[key] = value;
        await writeMemoryStore(store);
        return `Saved: ${key}`;
      }
    }),

    memory_read: tool({
      description: 'Read a value from persistent memory.',
      parameters: z.object({ key: z.string() }),
      execute: async ({ key }) => {
        const store = await readMemoryStore();
        return store[key] ?? `Key "${key}" not found`;
      }
    }),

    memory_list: tool({
      description: 'List all keys in persistent memory.',
      parameters: z.object({}),
      execute: async () => {
        const store = await readMemoryStore();
        const keys = Object.keys(store);
        return keys.length ? keys.join('\n') : '(memory is empty)';
      }
    }),

    memory_delete: tool({
      description: 'Delete a key from persistent memory.',
      parameters: z.object({ key: z.string() }),
      execute: async ({ key }) => {
        const store = await readMemoryStore();
        if (!(key in store)) return `Key "${key}" not found`;
        delete store[key];
        await writeMemoryStore(store);
        return `Deleted: ${key}`;
      }
    }),

    // ── PLANIFICACIÓN ─────────────────────────────────────
    create_plan: tool({
      description: 'Create a visible step-by-step plan before executing a task.',
      parameters: z.object({
        title: z.string(),
        steps: z.array(z.string())
      }),
      execute: async ({ title, steps }) => {
        return `📋 PLAN: ${title}\n${steps.map((s, i) => `${i + 1}. ⬜ ${s}`).join('\n')}`;
      }
    }),

    update_plan: tool({
      description: 'Update the status of a plan step.',
      parameters: z.object({
        step: z.number(),
        status: z.enum(['done', 'failed', 'in_progress', 'skipped']),
        note: z.string().optional()
      }),
      execute: async ({ step, status, note }) => {
        const icons: any = { done: '✅', failed: '❌', in_progress: '⏳', skipped: '⏭️' };
        return `Step ${step}: ${icons[status]} ${status.toUpperCase()}${note ? ` — ${note}` : ''}`;
      }
    }),

    // ── CRON / SCHEDULING ─────────────────────────────────
    manage_cron: tool({
      description: 'Add, list or remove cron jobs.',
      parameters: z.object({
        action: z.enum(['list', 'add', 'remove']),
        job: z.string().optional().describe('Cron expression + command, e.g. "0 * * * * /usr/bin/backup.sh"')
      }),
      execute: async ({ action, job }) => {
        try {
          if (action === 'list') {
            const { stdout } = await execAsync('crontab -l 2>/dev/null || echo "(no crontab)"');
            return stdout.trim();
          }
          if (action === 'add' && job) {
            const tmpFile = path.join(os.tmpdir(), `cron_add_${Date.now()}.txt`);
            try {
              let current = '';
              try { current = (await execAsync('crontab -l 2>/dev/null')).stdout; } catch {}
              await fs.writeFile(tmpFile, current.trimEnd() + '\n' + job + '\n', 'utf-8');
              await execAsync(`crontab "${tmpFile}"`);
            } finally { fs.unlink(tmpFile).catch(() => {}); }
            return `Added cron: ${job}`;
          }
          if (action === 'remove' && job) {
            const tmpFile = path.join(os.tmpdir(), `cron_remove_${Date.now()}.txt`);
            try {
              let current = '';
              try { current = (await execAsync('crontab -l 2>/dev/null')).stdout; } catch {}
              const filtered = current.split('\n').filter(line => !line.includes(job)).join('\n');
              await fs.writeFile(tmpFile, filtered, 'utf-8');
              await execAsync(`crontab "${tmpFile}"`);
            } finally { fs.unlink(tmpFile).catch(() => {}); }
            return `Removed cron matching: ${job}`;
          }
          return 'Invalid action';
        } catch (err: any) { return `ERROR: ${err.message}`; }
      }
    }),

  };
}
