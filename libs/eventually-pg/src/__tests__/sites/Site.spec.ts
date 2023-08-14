import {
  app,
  broker,
  client,
  dispose,
  seed,
  store
} from "@rotorsoft/eventually";
import { Posts } from "./Posts.projector";
import { Site } from "./Site.aggregate";
import { Sites } from "./Sites.projector";
import { config, PostgresProjectorStore, PostgresStore } from "../../../";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

describe("Site aggregate with projections", () => {
  const pool = new Pool(config.pg);

  beforeAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS "SiteEvents";`);
    await pool.query(`DROP TABLE IF EXISTS "SiteEvents_subscriptions";`);
    await pool.query(`DROP TABLE IF EXISTS "Sites";`);
    await pool.query(`DROP TABLE IF EXISTS "Posts";`);

    store(PostgresStore("SiteEvents"));
    app()
      .with(Site)
      .with(Sites, {
        projector: {
          store: PostgresProjectorStore("Sites"),
          indexes: [{ userId: "asc" }]
        }
      })
      .with(Posts, {
        projector: {
          store: PostgresProjectorStore("Posts"),
          indexes: [{ userId: "asc" }, { siteId: "asc" }]
        }
      })
      .build();
    await seed();
  });

  afterAll(async () => {
    await pool.end();
    await dispose()();
  });

  it("should handle commands", async () => {
    const userId = randomUUID();
    const target = {
      stream: randomUUID(),
      actor: { id: userId, name: "actor", roles: [] }
    };
    await client().command(
      Site,
      "CreateSite",
      {
        name: "TestSite",
        userId: target.actor.id,
        description: "TestSiteDesc"
      },
      target
    );
    await client().command(
      Site,
      "UpdateSite",
      {
        description: "Just a new description"
      },
      target
    );
    await client().command(
      Site,
      "CreatePost",
      {
        slug: "first-post",
        userId,
        title: "First Post",
        published: false
      },
      target
    );
    await client().command(
      Site,
      "CreatePost",
      {
        slug: "second-post",
        userId,
        title: "Second Post",
        published: false
      },
      target
    );
    await client().command(
      Site,
      "UpdatePost",
      {
        id: "first-post",
        title: "Better title"
      },
      target
    );
    await client().command(
      Site,
      "UpdatePost",
      {
        id: "first-post",
        description: "Describes my first post",
        content: "Some content"
      },
      target
    );
    await client().command(
      Site,
      "UpdatePost",
      {
        id: "second-post",
        slug: "just-change-the-slug",
        description: "Slug changed"
      },
      target
    );
    await broker().drain();

    // test aggregate state
    const snap = await client().load(Site, target.stream);
    expect(snap.state).toEqual({
      description: "Just a new description",
      font: "",
      name: "TestSite",
      posts: {
        "first-post": {
          content: "Some content",
          description: "Describes my first post",
          published: false,
          title: "Better title",
          userId
        },
        "just-change-the-slug": {
          description: "Slug changed",
          published: false,
          title: "Second Post",
          userId
        }
      },
      userId
    });

    // test projections
    const site = await client().read(Sites, target.stream);
    expect(site.at(0)?.state).toMatchObject({
      description: "Just a new description",
      font: "",
      id: target.stream,
      image: null,
      logo: null,
      message404: null,
      name: "TestSite",
      userId,
      userImage: null
    });

    const p1 = await client().read(Posts, "first-post");
    const p2 = await client().read(Posts, "just-change-the-slug");
    const p3 = await client().read(Posts, "second-post");

    expect(p1.at(0)?.state).toMatchObject({
      description: "Describes my first post",
      id: "first-post",
      siteId: target.stream,
      title: "Better title",
      content: "Some content",
      published: false,
      image: null,
      userId,
      userImage: null
    });
    expect(p2.at(0)?.state).toMatchObject({
      description: "Slug changed",
      id: "just-change-the-slug",
      siteId: target.stream,
      title: "Second Post",
      content: null,
      published: false,
      image: null,
      userId,
      userImage: null
    });
    expect(p3.at(0)?.state).toBeUndefined();
  });
});
