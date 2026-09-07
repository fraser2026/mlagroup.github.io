import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedHint = 'REGANCHOR_MCP_ACCESS_TOKEN';

const client = new Client({ name: 'reganchor-smoke-test', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [new URL('./server.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
  env: {
    ...process.env,
    REGANCHOR_SUPABASE_URL: '',
    REGANCHOR_ANON_KEY: '',
    REGANCHOR_MCP_ACCESS_TOKEN: '',
  },
});

try {
  await client.connect(transport);
  console.error('Expected stdio adapter to exit without credentials.');
  process.exit(1);
} catch {
  console.log(`stdio adapter correctly requires ${expectedHint} from device login (or use remote HTTP MCP).`);
}
