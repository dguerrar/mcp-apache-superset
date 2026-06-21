import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SupersetClient, AuthProvider } from "./superset-client.js";

const SUPERSET_URL = process.env.SUPERSET_URL ?? "http://localhost:8088";
const SUPERSET_USERNAME = process.env.SUPERSET_USERNAME ?? "admin";
const SUPERSET_PASSWORD = process.env.SUPERSET_PASSWORD ?? "admin";
const SUPERSET_ACCESS_TOKEN = process.env.SUPERSET_ACCESS_TOKEN;
const SUPERSET_AUTH_PROVIDER = (process.env.SUPERSET_AUTH_PROVIDER ?? "db") as AuthProvider;

const client = new SupersetClient({
  baseUrl: SUPERSET_URL,
  username: SUPERSET_USERNAME,
  password: SUPERSET_PASSWORD,
  accessToken: SUPERSET_ACCESS_TOKEN,
  authProvider: SUPERSET_AUTH_PROVIDER,
});

const server = new McpServer({
  name: "mcp-apache-superset",
  version: "1.0.0",
});

// --- Charts ---

server.tool(
  "list_charts",
  "List charts from Apache Superset with optional pagination",
  { page: z.number().optional(), page_size: z.number().optional() },
  async ({ page, page_size }) => {
    const params = new URLSearchParams();
    if (page !== undefined) params.set("q", JSON.stringify({ page, page_size: page_size ?? 25 }));
    const path = `/chart/?${params.toString()}`;
    const data = await client.get(path);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_chart",
  "Get details of a specific chart by ID",
  { id: z.number() },
  async ({ id }) => {
    const data = await client.get(`/chart/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_chart_data",
  "Execute a chart's query and return its data",
  { id: z.number() },
  async ({ id }) => {
    const data = await client.get(`/chart/${id}/data/`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Dashboards ---

server.tool(
  "list_dashboards",
  "List dashboards from Apache Superset",
  { page: z.number().optional(), page_size: z.number().optional() },
  async ({ page, page_size }) => {
    const params = new URLSearchParams();
    if (page !== undefined) params.set("q", JSON.stringify({ page, page_size: page_size ?? 25 }));
    const path = `/dashboard/?${params.toString()}`;
    const data = await client.get(path);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_dashboard",
  "Get details of a specific dashboard by ID",
  { id: z.number() },
  async ({ id }) => {
    const data = await client.get(`/dashboard/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Datasets ---

server.tool(
  "list_datasets",
  "List datasets (tables/views) registered in Superset",
  { page: z.number().optional(), page_size: z.number().optional() },
  async ({ page, page_size }) => {
    const params = new URLSearchParams();
    if (page !== undefined) params.set("q", JSON.stringify({ page, page_size: page_size ?? 25 }));
    const path = `/dataset/?${params.toString()}`;
    const data = await client.get(path);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_dataset",
  "Get details of a specific dataset by ID",
  { id: z.number() },
  async ({ id }) => {
    const data = await client.get(`/dataset/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Databases ---

server.tool(
  "list_databases",
  "List database connections configured in Superset",
  {},
  async () => {
    const data = await client.get("/database/");
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

server.tool(
  "get_database",
  "Get details of a specific database connection by ID",
  { id: z.number() },
  async ({ id }) => {
    const data = await client.get(`/database/${id}`);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- SQL Lab / Queries ---

server.tool(
  "execute_sql",
  "Execute a SQL query against a database in Superset (via SQL Lab)",
  {
    database_id: z.number().describe("ID of the database connection to query"),
    sql: z.string().describe("SQL query to execute"),
    schema: z.string().optional().describe("Database schema to use"),
  },
  async ({ database_id, sql, schema }) => {
    const payload: Record<string, unknown> = {
      database_id,
      sql,
      runAsync: false,
      select_as_cta: false,
      ctas_method: "TABLE",
    };
    if (schema) payload.schema = schema;

    const data = await client.post("/sqllab/execute/", payload);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Saved Queries ---

server.tool(
  "list_saved_queries",
  "List saved queries in SQL Lab",
  { page: z.number().optional(), page_size: z.number().optional() },
  async ({ page, page_size }) => {
    const params = new URLSearchParams();
    if (page !== undefined) params.set("q", JSON.stringify({ page, page_size: page_size ?? 25 }));
    const path = `/saved_query/?${params.toString()}`;
    const data = await client.get(path);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Query History ---

server.tool(
  "list_queries",
  "List recent query executions",
  { page: z.number().optional(), page_size: z.number().optional() },
  async ({ page, page_size }) => {
    const params = new URLSearchParams();
    if (page !== undefined) params.set("q", JSON.stringify({ page, page_size: page_size ?? 25 }));
    const path = `/query/?${params.toString()}`;
    const data = await client.get(path);
    return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
  }
);

// --- Start server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Apache Superset server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
