"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  clientLog,
  initClientLogger,
  recordBreadcrumb,
  setClientLogProjectId,
} from "../../platform/clientLogger";
import { useProjectsStore } from "../../state/projectsStore";

/**
 * Mounts once at the root layout to attach global browser error/rejection
 * listeners, sync the active `projectId` for diagnostic logs, and record
 * route-change and project-state breadcrumbs into the in-memory ring buffer.
 * Renders nothing.
 */
export function ClientLogInit() {
  const pathname = usePathname();
  const currentId = useProjectsStore((s) => s.currentId);
  const saveFailedProjectId = useProjectsStore((s) => s.saveFailedProjectId);
  const staleProjectId = useProjectsStore((s) => s.staleProjectId);

  useEffect(() => {
    initClientLogger();
  }, []);

  useEffect(() => {
    if (pathname) {
      recordBreadcrumb("route", "navigate", pathname);
    }
  }, [pathname]);

  useEffect(() => {
    setClientLogProjectId(currentId);
    if (currentId) {
      recordBreadcrumb("studio", "open_project", currentId);
    }
  }, [currentId]);

  useEffect(() => {
    if (saveFailedProjectId) {
      clientLog.warn({
        domain: "studio",
        event: "project.save.failed",
        message: "Saving book changes to storage failed transiently; retrying in background.",
        projectId: saveFailedProjectId,
      });
    }
  }, [saveFailedProjectId]);

  useEffect(() => {
    if (staleProjectId) {
      clientLog.warn({
        domain: "studio",
        event: "project.save.conflict",
        message: "Book was modified on another device or tab (version conflict).",
        projectId: staleProjectId,
      });
    }
  }, [staleProjectId]);

  return null;
}
