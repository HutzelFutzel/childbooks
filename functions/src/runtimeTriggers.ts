/**
 * Drop-in replacements for the non-HTTP trigger factories.
 *
 * The sandbox↔live toggle is a Firestore override (`appConfig/runtime`) that
 * `serverConfig()` reads from an in-memory cache. HTTP requests fill that cache
 * in `attachUser`; scheduled jobs and Cloud Tasks workers are separate services
 * that never see a request, so without this they would run on the deploy
 * default (`LULU_ENV` / `STRIPE_ENV`) while the storefront runs live — placing
 * retried orders, refunding, and labelling their logs against the wrong
 * environment. Every such handler loads the override before it starts.
 */
import {
  onSchedule as baseOnSchedule,
  type ScheduleFunction,
  type ScheduleOptions,
  type ScheduledEvent,
} from "firebase-functions/v2/scheduler";
import {
  onTaskDispatched as baseOnTaskDispatched,
  type Request,
  type TaskQueueFunction,
  type TaskQueueOptions,
} from "firebase-functions/v2/tasks";
import { refreshRuntimeEnv } from "./runtimeConfig";

/** Load the active sandbox/live override for this instance. Never throws. */
export async function loadRuntimeEnv(): Promise<void> {
  await refreshRuntimeEnv().catch(() => {});
}

export function onSchedule(
  options: ScheduleOptions,
  handler: (event: ScheduledEvent) => void | Promise<void>,
): ScheduleFunction {
  return baseOnSchedule(options, async (event) => {
    await loadRuntimeEnv();
    await handler(event);
  });
}

export function onTaskDispatched<Args = unknown>(
  options: TaskQueueOptions,
  handler: (request: Request<Args>) => void | Promise<void>,
): TaskQueueFunction<Args> {
  return baseOnTaskDispatched<Args>(options, async (request) => {
    await loadRuntimeEnv();
    await handler(request);
  });
}
