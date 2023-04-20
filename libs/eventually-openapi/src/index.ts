import { app, config } from "@rotorsoft/eventually";
import { oas31 } from "openapi3-ts";
import { getComponents, getPahts, getSecurity, getTags } from "./utils";

export * from "./specs";
export * from "./types";
export * from "./utils";

const security = getSecurity();

export const openAPI = (): oas31.OpenAPIObject => {
  const { service, version, description, author, license } = config();
  const allStream = app().hasStreams;
  return {
    openapi: "3.1.0",
    info: {
      title: service,
      version: version,
      description: description,
      contact: author,
      license: { name: license }
    },
    servers: [{ url: "/" }],
    tags: getTags(allStream),
    components: getComponents(allStream, security),
    paths: getPahts(allStream, security)
  };
};