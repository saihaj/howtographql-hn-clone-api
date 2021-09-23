import fastify from "fastify";
import { getGraphQLParameters, processRequest, Request } from "graphql-helix";
import { renderPlaygroundPage } from "graphql-playground-html";
import { PrismaClient } from "@prisma/client";
import { verify, JwtPayload } from "jsonwebtoken";
import { schema, APP_SECRET } from "./schema";
import { pubSub } from "./pubsub";

const prisma = new PrismaClient();

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
          pubSub,
        };
      },
      operationName,
      query,
      variables,
    });

    if (result.type === "RESPONSE") {
      reply.send(result.payload);
    } else if (result.type === "PUSH") {
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("Cache-Control", "no-cache,no-transform");
      reply.raw.setHeader("x-no-compression", 1);

      // If the request is closed by the client, we unsubscribe and stop executing the request
      req.raw.on("close", () => {
        result.unsubscribe();
      });

      // We subscribe to the event stream and push any new events to the client
      await result.subscribe((result) => {
        reply.raw.write(`data: ${JSON.stringify(result)}\n\n`);
      });
    } else {
      reply.send({ error: "Stream not supported at the moment" });
    }
  });

  server.listen(3000, "0.0.0.0");
}

main();
