import fastify from "fastify";
import { execute } from "graphql";
import { exec } from "child_process";
import { getGraphQLParameters, processRequest, Request } from "graphql-helix";
import { renderPlaygroundPage } from "graphql-playground-html";
import { PrismaClient } from "@prisma/client";
import { verify, JwtPayload } from "jsonwebtoken";
import { schema, APP_SECRET } from "./schema";
import { createHive } from "@graphql-hive/client";
import { config } from "dotenv";
import { GraphQLContext } from "./context";
import { version, author } from "../package.json";

const prisma = new PrismaClient();

let GIT_AUTHOR = author;
let GIT_COMMIT = "cool";

exec("git log -1 --pretty=format:'%an'", (_, stdout) => {
  GIT_AUTHOR = stdout;
});

exec("git rev-parse HEAD", (_, stdout) => {
  GIT_COMMIT = stdout;
});

// Load env vars
config();

// Setup Hive
const hive = createHive({
  enabled: true,
  debug: true,
  token: process.env.HIVE_TOKEN!,
  reporting: {
    author: GIT_AUTHOR,
    commit: GIT_COMMIT,
  },
  usage: {
    clientInfo(ctx: GraphQLContext) {
      return {
        name: ctx.currentUser?.name || "Unauthenticated user",
        version,
      };
    },
  },
});

hive.reportSchema({ schema });

async function main() {
  const server = fastify();

  server.get("/playground", (_, reply) => {
    reply.header("Content-Type", "text/html");
    reply.send(
      renderPlaygroundPage({
        endpoint: "/graphql",
      })
    );
  });

  server.post("/graphql", async (req, reply) => {
    const request: Request = {
      headers: req.headers,
      method: req.method,
      query: req.query,
      body: req.body,
    };

    const { operationName, query, variables } = getGraphQLParameters(request);

    const result = await processRequest({
      request,
      schema,
      execute: async (...args) => {
        const executionArgs = {
          schema: args[0],
          document: args[1],
          rootValue: args[2],
          contextValue: args[3],
          variableValues: args[4],
          operationName: args[5],
        };

        const finish = hive.collectUsage(executionArgs);
        const result = await execute(executionArgs);
        finish(result);
        return result;
      },
      contextFactory: async () => {
        let currentUser = null;

        if (req.headers.authorization) {
          const token = req.headers.authorization.split(" ")[1];
          try {
            const tokenPayload = verify(token, APP_SECRET) as JwtPayload;
            const userId = tokenPayload.userId;
            currentUser = await prisma.user.findUnique({
              where: { id: userId },
            });
          } catch (e) {
            // We allow the request to go through so user can log in or access other unauthenticated operations
          }
        }

        return {
          prisma,
          currentUser,
        };
      },
      operationName,
      query,
      variables,
    });

    if (result.type === "RESPONSE") {
      reply.send(result.payload);
    } else {
      reply.send({ error: "Stream not supported at the moment" });
    }
  });

  server.listen(3000, "0.0.0.0");
}

main();
