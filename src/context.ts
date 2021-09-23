import { PrismaClient, User } from "@prisma/client";
import { pubSub } from "./pubsub";

export type GraphQLContext = {
  prisma: PrismaClient;
  currentUser: User | null;
  pubSub: typeof pubSub;
};
