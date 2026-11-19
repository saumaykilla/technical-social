import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createApp } from "./app.ts";
import { openDatabase } from "./db.ts";

async function start(now: () => Date = () => new Date("2026-11-18T15:00:00.000Z")) {
  const db = openDatabase(":memory:");
  const app = createApp(db, now);
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected a TCP port.");
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function post(url: string, path: string, body: unknown) {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

const registration = {
  email: "Ada@Example.com",
  name: "Ada Lovelace",
  linkedin: "https://www.linkedin.com/in/ada",
  website: "https://ada.example",
  profession: "Engineer",
};

test("register stores a profile and checks the attendee in for the UTC date", async (t) => {
  const { server, url } = await start();
  t.after(() => server.close());

  const { status, body } = await post(url, "/api/attendance/register", registration);

  assert.equal(status, 201);
  assert.equal(body.profile.email, "ada@example.com");
  assert.equal(body.profile.name, "Ada Lovelace");
  assert.equal(body.profile.website, "https://ada.example");
  assert.equal(body.profile.profession, "Engineer");
  assert.deepEqual(body.visits, [{
    date: "2026-11-18",
    attendees: [{
      id: body.profile.id,
      name: "Ada Lovelace",
      linkedin: "https://www.linkedin.com/in/ada",
      website: "https://ada.example",
      profession: "Engineer",
    }],
  }]);
  assert.equal("email" in body.visits[0].attendees[0], false);
});

test("register rejects a duplicate email and an incomplete profile", async (t) => {
  const { server, url } = await start();
  t.after(() => server.close());

  await post(url, "/api/attendance/register", registration);
  const duplicate = await post(url, "/api/attendance/register", registration);
  assert.equal(duplicate.status, 409);

  const invalid = await post(url, "/api/attendance/register", {
    email: "ada@example.com",
    name: "Ada",
    linkedin: "not-a-url",
  });
  assert.equal(invalid.status, 400);
});

test("lookup checks an existing attendee in without duplicating the same day", async (t) => {
  let current = new Date("2026-11-18T15:00:00.000Z");
  const { server, url } = await start(() => current);
  t.after(() => server.close());

  await post(url, "/api/attendance/register", registration);
  await post(url, "/api/attendance/register", {
    email: "grace@example.com",
    name: "Grace Hopper",
    linkedin: "https://www.linkedin.com/in/grace",
  });

  const first = await post(url, "/api/attendance/lookup", { email: " ada@example.com " });
  const second = await post(url, "/api/attendance/lookup", { email: "ada@example.com" });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.visits.length, 1);
  assert.equal(second.body.visits[0].attendees.length, 2);
  assert.deepEqual(
    second.body.visits[0].attendees.map((attendee: { name: string }) => attendee.name).sort(),
    ["Ada Lovelace", "Grace Hopper"],
  );
  assert.equal(second.body.visits[0].attendees.every((attendee: object) => !("email" in attendee)), true);

  current = new Date("2026-11-19T01:00:00.000Z");
  const nextDay = await post(url, "/api/attendance/lookup", { email: "ada@example.com" });
  assert.deepEqual(nextDay.body.visits.map((visit: { date: string; attendees: { name: string }[] }) => ({
    date: visit.date,
    names: visit.attendees.map((attendee) => attendee.name),
  })), [
    { date: "2026-11-19", names: ["Ada Lovelace"] },
    { date: "2026-11-18", names: ["Ada Lovelace", "Grace Hopper"] },
  ]);
});

test("allows each origin listed in API_CORS_ORIGIN", async (t) => {
  const previous = process.env.API_CORS_ORIGIN;
  process.env.API_CORS_ORIGIN = "https://technicallysocial.org, https://www.technicallysocial.org";
  t.after(() => {
    if (previous === undefined) delete process.env.API_CORS_ORIGIN;
    else process.env.API_CORS_ORIGIN = previous;
  });

  const { server, url } = await start();
  t.after(() => server.close());

  const response = await fetch(`${url}/health`, {
    headers: { Origin: "https://www.technicallysocial.org" },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://www.technicallysocial.org");
});

test("lookup reports an unknown email and rejects an invalid one", async (t) => {
  const { server, url } = await start();
  t.after(() => server.close());

  const missing = await post(url, "/api/attendance/lookup", { email: "missing@example.com" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.registrationRequired, true);

  const invalid = await post(url, "/api/attendance/lookup", { email: "not-an-email" });
  assert.equal(invalid.status, 400);
});
