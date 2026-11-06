/**
 * Invariants for saving a book: why a save fails, when it is tried again, what is kept on the device
 * until the cloud has it, how it is put back, and how full a book is.
 *
 * The real project store runs against a fake cloud and an in-memory outbox: no network, no browser.
 */
import assert from "node:assert/strict";
import { createMemoryOutbox, decideRecovery, recoveredBook, type OutboxRecord } from "../books-frontend/src/core/storage/outbox";
import {
  LONG_FAILURE_ATTEMPTS,
  RETRY_BASE_MS,
  RETRY_MAX_MS,
  isRetryable,
  retryDelayMs,
  saveFailureNote,
  saveFailureReasonOf,
} from "../books-frontend/src/core/storage/saveRecovery";
import { STORED_BOOK_LIMIT_BYTES, biggestParts, createSizeWatch, sizeLevelOf } from "../books-frontend/src/core/storage/bookSize";
import { NotSignedInError, StoredValueTooLargeError, type KeyValueStore } from "../books-frontend/src/core/storage/types";
import { configureOutbox } from "../books-frontend/src/platform/localOutbox";
import { useStorageBackendForChecks } from "../books-frontend/src/platform/storage";
import { resetReposForChecks } from "../books-frontend/src/state/repos";
import { flushProjectSaves, useProjectsStore } from "../books-frontend/src/state/projectsStore";
import type { Project } from "../books-frontend/src/core/types";

let passed = 0;
function check(condition: unknown, message: string): void {
  assert.ok(condition, message);
  passed += 1;
}

function section(name: string): void {
  console.log(`  ${name}`);
}

// ---------------------------------------------------------------------------------------------
section("why a save failed");

check(saveFailureReasonOf(new StoredValueTooLargeError("project:x", 2_000_000, 1_048_000)) === "tooLarge", "an oversized book is too large");
check(saveFailureReasonOf(new Error("The value of property json is longer than 1048487 bytes.")) === "tooLarge", "the backend's own size error is too large");
check(saveFailureReasonOf(new NotSignedInError()) === "signedOut", "no signed-in user is signed out");
check(saveFailureReasonOf(Object.assign(new Error("x"), { code: "unauthenticated" })) === "signedOut", "an expired session is signed out");
check(saveFailureReasonOf(Object.assign(new Error("x"), { code: "permission-denied" })) === "rejected", "a refused write is rejected");
check(saveFailureReasonOf(Object.assign(new Error("x"), { code: "invalid-argument" })) === "rejected", "an invalid write is rejected");
check(saveFailureReasonOf(Object.assign(new Error("x"), { code: "unavailable" })) === "transient", "an unreachable backend is transient");
check(saveFailureReasonOf(new TypeError("boom")) === "transient", "anything unknown is transient, and so still visible");
check(isRetryable("transient") && !isRetryable("signedOut") && !isRetryable("tooLarge") && !isRetryable("rejected"), "only a transient failure is retried on a timer");

// ---------------------------------------------------------------------------------------------
section("when it is tried again");

const noJitter = () => 0.5;
check(retryDelayMs(1, noJitter) === RETRY_BASE_MS, "the first retry waits the base time");
check(retryDelayMs(2, noJitter) === RETRY_BASE_MS * 2 && retryDelayMs(3, noJitter) === RETRY_BASE_MS * 4, "each retry waits twice as long");
check(retryDelayMs(20, noJitter) === RETRY_MAX_MS, "a wait never passes a minute");
check(retryDelayMs(3, () => 0) < retryDelayMs(3, () => 1), "the wait is spread, so tabs coming back together do not all knock at once");
check(retryDelayMs(30, () => 1) <= RETRY_MAX_MS * 1.2, "even the widest spread stays near the cap");
check(retryDelayMs(0, noJitter) === RETRY_BASE_MS, "a bad attempt number is the first retry");
check(saveFailureNote("transient", 1, true) === "transient", "a first failure says to check the connection");
check(saveFailureNote("transient", LONG_FAILURE_ATTEMPTS, true) === "stubborn", "a failure that keeps coming back online says so");
check(saveFailureNote("transient", LONG_FAILURE_ATTEMPTS, false) === "transient", "offline, the connection is still the reason");
check(saveFailureNote("tooLarge", 99, true) === "tooLarge", "the other reasons keep their own note");

// ---------------------------------------------------------------------------------------------
section("how full a book is");

check(sizeLevelOf(STORED_BOOK_LIMIT_BYTES * 0.3) === null, "a small book is not reported");
check(sizeLevelOf(STORED_BOOK_LIMIT_BYTES * 0.5) === 0.5, "half is the first level");
check(sizeLevelOf(STORED_BOOK_LIMIT_BYTES * 0.8) === 0.75, "the highest level reached is reported");
check(sizeLevelOf(STORED_BOOK_LIMIT_BYTES * 0.95) === 0.9, "nine tenths is the last level");
{
  const watch = createSizeWatch();
  const at = (ratio: number) => watch.observe("a", STORED_BOOK_LIMIT_BYTES * ratio);
  check(at(0.2) === null, "below the first level: nothing");
  check(at(0.55) === 0.5, "the first crossing is reported");
  check(at(0.6) === null, "the same level is not reported twice");
  check(at(0.8) === 0.75, "a higher level is reported");
  check(at(0.4) === null && at(0.78) === null, "a book that shrinks and grows again is not reported twice");
  check(watch.observe("b", STORED_BOOK_LIMIT_BYTES * 0.55) === 0.5, "each book has its own levels");
}
{
  const parts = biggestParts({ id: "p", title: "x".repeat(5), illustrations: { a: "y".repeat(500) }, screenplay: "z".repeat(50) } as unknown as Project, 2);
  check(parts.length === 2 && parts[0]!.part === "illustrations" && parts[1]!.part === "screenplay", "the biggest parts of a book are named, biggest first");
}

// ---------------------------------------------------------------------------------------------
section("the copy kept on the device");

const UID = "u1";
function bookOf(id: string, over: Partial<Project> = {}): Project {
  return {
    id,
    title: "A book",
    createdAt: 1,
    updatedAt: 1000,
    stage: "setup",
    furthestStage: "setup",
    rev: 1,
    config: { storyText: "" },
    ...over,
  } as unknown as Project;
}
function recordOf(project: Project, over: Partial<OutboxRecord> = {}): OutboxRecord {
  return { uid: UID, projectId: project.id, project, baseRev: project.rev ?? 0, savedAt: 5, ...over };
}

{
  const outbox = createMemoryOutbox();
  const base = bookOf("b", { rev: 3 });
  await outbox.put(recordOf(bookOf("b", { rev: 3, title: "one" }), { base }));
  await outbox.put(recordOf(bookOf("b", { rev: 3, title: "two" })));
  check((await outbox.get(UID, "b"))?.base?.rev === 3, "a record without a base keeps the one already stored for the same revision");
  await outbox.put(recordOf(bookOf("b", { rev: 4, title: "three" }), { baseRev: 4 }));
  check((await outbox.get(UID, "b"))?.base === undefined, "a new revision does not inherit an older base");
  check((await outbox.get(UID, "b"))?.project.title === "three", "the newest edit replaces the older one");

  await outbox.put(recordOf(bookOf("b", { updatedAt: 2000 })));
  check(!(await outbox.delete(UID, "b", 1500)), "an edit newer than the save that finished is not dropped");
  check(Boolean(await outbox.get(UID, "b")), "so the record is still there");
  check(await outbox.delete(UID, "b", 2000), "an edit the save covered is dropped");
  check((await outbox.get(UID, "b")) === null, "and is gone");

  await outbox.put(recordOf(bookOf("x")));
  await outbox.put({ ...recordOf(bookOf("y")), uid: "someone-else" });
  await outbox.deleteUser(UID);
  check((await outbox.list(UID)).length === 0 && (await outbox.list("someone-else")).length === 1, "signing out drops that user's records and no one else's");
}

// ---------------------------------------------------------------------------------------------
section("what to do with it on the next open");

{
  const edited = bookOf("b", { rev: 2, title: "Edited here", updatedAt: 2000 });
  const record = recordOf(edited, { base: bookOf("b", { rev: 2 }) });
  const cloudSame = bookOf("b", { rev: 2 });
  check(decideRecovery(record, null).kind === "orphan", "no book in the cloud is an orphan");
  check(decideRecovery(record, { ...edited, rev: 3, updatedAt: 3000 }).kind === "landed", "the cloud already holding the same book means the save landed");
  check(decideRecovery(record, cloudSame).kind === "restore", "the cloud where the edits started: put them back");
  check(decideRecovery(record, bookOf("b", { rev: 5, title: "Other" })).kind === "merge", "the cloud moved on: merge");
  check(decideRecovery({ ...record, base: undefined }, bookOf("b", { rev: 5, title: "Other" })).kind === "unmergeable", "moved on without the base: nothing can be merged safely");
  check(decideRecovery(record, bookOf("b", { rev: 1, title: "Older" })).kind === "ahead", "a cloud behind the edits is kept and reported");

  const restored = recoveredBook(record, cloudSame, { kind: "restore" }, 9)!;
  check(restored.project.title === "Edited here" && restored.project.rev === 2, "a restore brings the edits back on the cloud's revision");

  const cloudMoved = bookOf("b", { rev: 6, config: { storyText: "Changed elsewhere" } as Project["config"], title: "A book" });
  const merged = recoveredBook(record, cloudMoved, { kind: "merge" }, 9)!;
  check(merged.project.title === "Edited here" && merged.project.config.storyText === "Changed elsewhere", "a merge keeps what each side changed");
  check(merged.conflicts.length === 0 && merged.project.rev === 6, "different fields do not conflict, and the revision is the cloud's");

  const both = recoveredBook(record, bookOf("b", { rev: 6, title: "Edited there" }), { kind: "merge" }, 9)!;
  check(both.project.title === "Edited here" && both.conflicts.includes("title"), "a field both changed keeps the edit made here");
  const replaced = (both.project.authoringState as { replaced?: { fields: Record<string, unknown> }[] } | undefined)?.replaced;
  check(replaced?.[0]?.fields.title === "Edited there", "and the other value is kept in the book's history, not lost");
}

// ---------------------------------------------------------------------------------------------
section("saving, failing and coming back (the real store, a fake cloud)");

type Gate = { wait: Promise<void>; open: () => void };
function gate(): Gate {
  let open: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait, open };
}

const docs = new Map<string, unknown>();
let failNext: unknown = null;
let hold: Gate | null = null;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const kv: KeyValueStore = {
  async get<T>(key: string) {
    return docs.has(key) ? copy(docs.get(key) as T) : null;
  },
  async set(key, value) {
    docs.set(key, copy(value));
  },
  async remove(key) {
    docs.delete(key);
  },
  async keys() {
    return [...docs.keys()];
  },
  async listByPrefix<T>(prefix: string) {
    return [...docs].filter(([key]) => key.startsWith(prefix)).map(([, value]) => copy(value as T));
  },
  async update<T>(key: string, mutator: (prev: T | null) => T) {
    if (hold) await hold.wait;
    if (failNext) {
      const error = failNext;
      failNext = null;
      throw error;
    }
    const next = mutator(docs.has(key) ? copy(docs.get(key) as T) : null);
    docs.set(key, copy(next));
    return next;
  },
};
useStorageBackendForChecks({ kv, blobs: {} as never });
resetReposForChecks();
const outbox = createMemoryOutbox();
configureOutbox({ store: outbox, uid: UID });

const store = useProjectsStore;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const stored = (id: string) => docs.get(`project:${id}`) as Project | undefined;

/** A fresh session on a book that the cloud holds at revision 1. */
async function openSession(id: string, over: Partial<Project> = {}): Promise<void> {
  docs.set(`project:${id}`, bookOf(id, over));
  await store.getState().load();
  store.getState().openProject(id);
}
async function edit(title: string): Promise<void> {
  const done = store.getState().patchCurrent((p) => ({ ...p, title }));
  await flushProjectSaves();
  await done;
  await tick();
}

{
  await openSession("ok");
  await edit("Saved title");
  check(stored("ok")?.title === "Saved title" && stored("ok")?.rev === 2, "a save lands in the cloud and moves the revision on");
  check((await outbox.get(UID, "ok")) === null, "and nothing is kept on the device once the cloud has it");
  check(store.getState().saveFailedProjectId === null, "no failure is shown");
}

{
  await openSession("net");
  failNext = Object.assign(new Error("offline"), { code: "unavailable" });
  await edit("Typed offline");
  const state = store.getState();
  check(state.saveFailedProjectId === "net" && state.saveFailureReason === "transient" && state.saveFailureAttempts === 1, "an unreachable cloud shows a temporary failure");
  check(stored("net")?.title === "A book", "the cloud was not changed");
  const kept = await outbox.get(UID, "net");
  check(kept?.project.title === "Typed offline" && kept?.baseRev === 1, "the edit is kept on the device, with the revision it was made on");
  check(kept?.base?.title === "A book", "with the cloud copy it came from");
  failNext = Object.assign(new Error("still offline"), { code: "unavailable" });
  await store.getState().retrySave("net");
  check(store.getState().saveFailureAttempts === 2, "each failed try is counted");
  await store.getState().retrySave("net");
  const after = store.getState();
  check(after.saveFailedProjectId === null && after.saveFailureAttempts === 0, "a later save that lands clears the failure");
  check(stored("net")?.title === "Typed offline", "the cloud has the edit");
  await tick();
  check((await outbox.get(UID, "net")) === null, "and the device copy is dropped");
}

{
  await openSession("out");
  failNext = new NotSignedInError();
  await edit("Typed signed out");
  check(store.getState().saveFailureReason === "signedOut", "a lost session shows its own failure");
  check((await outbox.get(UID, "out"))?.project.title === "Typed signed out", "and the edit is kept");
  await store.getState().retrySave("out");
  check(store.getState().saveFailedProjectId === null && stored("out")?.title === "Typed signed out", "signing in again lets it save");
}

{
  await openSession("big");
  failNext = new StoredValueTooLargeError("project:big", 2_000_000, STORED_BOOK_LIMIT_BYTES);
  await edit("Typed too big");
  check(store.getState().saveFailureReason === "tooLarge", "a book too large shows that, not a connection problem");
  check((await outbox.get(UID, "big"))?.project.title === "Typed too big", "and the edit is kept");
  await store.getState().retrySave("big");
  check(store.getState().saveFailedProjectId === null, "it saves once it fits again");
}

{
  // Before this, an error while preparing the save was swallowed: no banner, nothing kept.
  await openSession("prep", { illustrations: { p1: { nodes: null, cursorId: "n" } } as never });
  await edit("Typed while broken");
  check(store.getState().saveFailedProjectId === "prep", "an error before the save is shown, not swallowed");
  check((await outbox.get(UID, "prep"))?.project.title === "Typed while broken", "and the edit is kept");
}

{
  // A save that was already on its way must not drop an edit made after it started.
  await openSession("busy");
  hold = gate();
  const first = store.getState().patchCurrent((p) => ({ ...p, title: "First" }));
  const flushed = flushProjectSaves();
  await tick();
  void store.getState().patchCurrent((p) => ({ ...p, title: "Second" }));
  hold.open();
  hold = null;
  await flushed;
  await first;
  await tick();
  const left = await outbox.get(UID, "busy");
  check(stored("busy")?.title === "First", "the first save landed");
  check(left?.project.title === "First", "the device still holds the copy while a newer edit waits");
  await flushProjectSaves();
  await tick();
  check(stored("busy")?.title === "Second", "the newer edit lands");
  check((await outbox.get(UID, "busy")) === null, "and then nothing is left on the device");
}

{
  // The tab closed in the middle of a failed save; the next open finds the edit.
  await outbox.deleteUser(UID);
  docs.set("project:back", bookOf("back"));
  await outbox.put(recordOf(bookOf("back", { title: "Edited before the refresh", updatedAt: 2000 }), { base: bookOf("back"), savedAt: 101 }));
  await store.getState().load();
  const book = store.getState().projects.find((p) => p.id === "back");
  check(book?.title === "Edited before the refresh", "the edit that was never saved comes back");
  check(store.getState().recoveredNotice?.kind === "restored" && store.getState().recoveredNotice?.projectId === "back", "and the reader is told");
  await flushProjectSaves();
  await tick();
  check(stored("back")?.title === "Edited before the refresh", "it is saved at once");
  check((await outbox.get(UID, "back")) === null, "and the device copy is dropped");
  store.getState().dismissRecovered();
  check(store.getState().recoveredNotice === null, "the notice can be dismissed");
}

{
  // The cloud moved on (another tab saved something else): both sets of changes survive.
  await outbox.deleteUser(UID);
  const base = bookOf("moved", { config: { storyText: "Old story" } as Project["config"] });
  docs.set("project:moved", bookOf("moved", { rev: 4, config: { storyText: "New story from elsewhere" } as Project["config"] }));
  await outbox.put(recordOf(bookOf("moved", { title: "My new title", updatedAt: 2000, config: { storyText: "Old story" } as Project["config"] }), { base: { ...base, rev: 1 }, savedAt: 102 }));
  await store.getState().load();
  const merged = store.getState().projects.find((p) => p.id === "moved");
  check(merged?.title === "My new title" && merged?.config.storyText === "New story from elsewhere", "an edit made here and a change made elsewhere are both kept");
  check(store.getState().recoveredNotice?.kind === "merged", "and the reader is told it was merged");
  await flushProjectSaves();
  await tick();
  check(stored("moved")?.rev === 5, "the merge is saved on top of the newer revision");
}

{
  // The save landed; only the clean-up never ran.
  await outbox.deleteUser(UID);
  const landed = bookOf("landed", { rev: 3, title: "Same everywhere", updatedAt: 2000 });
  docs.set("project:landed", landed);
  store.getState().dismissRecovered();
  await outbox.put(recordOf(bookOf("landed", { rev: 2, title: "Same everywhere", updatedAt: 1900 }), { savedAt: 103 }));
  await store.getState().load();
  await tick();
  check((await outbox.get(UID, "landed")) === null, "a copy the cloud already has is dropped");
  check(store.getState().recoveredNotice === null, "without telling the reader anything");
}

{
  // The cloud is behind the edits: nothing is guessed, and nothing is deleted.
  await outbox.deleteUser(UID);
  docs.set("project:ahead", bookOf("ahead", { rev: 1, title: "Behind" }));
  await outbox.put(recordOf(bookOf("ahead", { rev: 7, title: "Ahead" }), { savedAt: 104 }));
  await store.getState().load();
  await tick();
  check(store.getState().projects.find((p) => p.id === "ahead")?.title === "Behind", "a cloud copy that is behind is not overwritten");
  check(Boolean(await outbox.get(UID, "ahead")), "and the device copy stays");
  await outbox.delete(UID, "ahead");
}

{
  // A book edited while the library was still loading keeps its newer edits.
  await openSession("later");
  await outbox.put(recordOf(bookOf("later", { title: "Old unsaved", updatedAt: 1500 }), { base: bookOf("later"), savedAt: 105 }));
  const preloaded = store.getState().projects.find((p) => p.id === "later")!;
  store.setState({ projects: [{ ...preloaded, title: "Typed meanwhile", updatedAt: 9000 }] });
  await store.getState().loadSingleProject("later");
  check(store.getState().projects.find((p) => p.id === "later")?.title === "Typed meanwhile", "a book already open and edited is not overwritten by an older copy");
  await outbox.deleteUser(UID);
}

{
  // Nothing breaks with no usable device storage.
  configureOutbox({ store: null, uid: UID });
  await openSession("nostore");
  await edit("No device storage");
  check(stored("nostore")?.title === "No device storage", "saving works without device storage");
  failNext = Object.assign(new Error("offline"), { code: "unavailable" });
  await edit("Fails without device storage");
  check(store.getState().saveFailedProjectId === "nostore", "a failure is still shown");
  await store.getState().retrySave("nostore");
  configureOutbox({ store: outbox, uid: UID });
}

console.log(`\n  ${passed} checks passed`);
