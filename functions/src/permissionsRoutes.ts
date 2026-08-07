/**
 * `/admin/permissions/*` — the owner-only Permissions page's API.
 *
 * `GET /me` is the one exception: every admin calls it (not just owners) to
 * learn their own role/grants so the dashboard can hide what they can't
 * reach and render read-only where they can't write. Everything else here is
 * owner-gated (`requireOwner`) or capability-gated (`requireCapability`) —
 * see `permissions.ts` for the role/capability model.
 */
import express, { type Express, type Response } from "express";
import {
  ALL_PERMISSION_KEYS,
  hasCapability,
  isOwner,
} from "../../books-frontend/src/core/config/permissions";
import {
  getAdminRecord,
  inviteAdmin,
  listAdmins,
  listAuditLog,
  PermissionError,
  removeAdmin,
  requireCapability,
  requireOwner,
  setGrants,
  setRole,
  type AdminRole,
  type PermissionedRequest,
} from "./permissions";

function sendError(res: Response, err: unknown): void {
  if (err instanceof PermissionError) {
    res.status(err.status).json({ error: { message: err.message } });
    return;
  }
  console.error("[permissions] request failed", err);
  res.status(500).json({ error: { message: (err as Error)?.message ?? "Request failed." } });
}

export function registerPermissionsRoutes(app: Express): void {
  const json = express.json({ limit: "16kb" });

  // Every admin's own access — drives the frontend's `AdminAccessContext`.
  app.get("/admin/permissions/me", async (req: PermissionedRequest, res: Response) => {
    try {
      if (!req.uid) {
        res.status(401).json({ error: { message: "Authentication required." } });
        return;
      }
      const record = await getAdminRecord(req.uid);
      if (!record) {
        res.status(403).json({ error: { message: "Admin access required." } });
        return;
      }
      res.json({
        admin: record,
        capabilities: {
          manage_owners: hasCapability(record.role, "manage_owners"),
          manage_admins: hasCapability(record.role, "manage_admins"),
          secrets: hasCapability(record.role, "secrets"),
          dangerous: hasCapability(record.role, "dangerous"),
        },
        permissionKeys: ALL_PERMISSION_KEYS,
      });
    } catch (err) {
      sendError(res, err);
    }
  });

  // The roster — who has access, at what tier, with what grants. Owners only
  // (an admin never sees the matrix, even their own — see the product spec).
  app.get("/admin/permissions/admins", requireOwner(), async (_req, res) => {
    try {
      res.json({ admins: await listAdmins() });
    } catch (err) {
      sendError(res, err);
    }
  });

  app.get("/admin/permissions/audit-log", requireOwner(), async (req, res) => {
    try {
      const limit = Number(req.query.limit);
      res.json({ entries: await listAuditLog(Number.isFinite(limit) ? limit : 200) });
    } catch (err) {
      sendError(res, err);
    }
  });

  // Invite (or attach) a plain admin by email. Owner-tier accounts are never
  // created this way — see the role routes below.
  app.post(
    "/admin/permissions/invite",
    json,
    requireCapability("manage_admins"),
    async (req: PermissionedRequest, res: Response) => {
      try {
        const email = String((req.body as { email?: unknown })?.email ?? "");
        const record = await inviteAdmin(req.uid as string, email);
        res.json({ admin: record });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  app.put(
    "/admin/permissions/admins/:uid/grants",
    json,
    requireCapability("manage_admins"),
    async (req: PermissionedRequest, res: Response) => {
      try {
        const record = await setGrants(req.uid as string, String(req.params.uid), req.body?.grants);
        res.json({ admin: record });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  app.delete(
    "/admin/permissions/admins/:uid",
    requireCapability("manage_admins"),
    async (req: PermissionedRequest, res: Response) => {
      try {
        const targetUid = String(req.params.uid);
        const target = await getAdminRecord(targetUid);
        // Removing an owner (t1 or t2) is owner-tier management, not plain
        // admin management — T2 callers stop here even though they hold
        // `manage_admins` (t1-only `manage_owners` is required past this point;
        // `removeAdmin` additionally hard-blocks removing a t1 at all).
        if (target && isOwner(target.role) && !hasCapability(req.admin!.role, "manage_owners")) {
          res.status(403).json({ error: { message: "Only a T1 owner can remove another owner." } });
          return;
        }
        await removeAdmin(req.uid as string, targetUid);
        res.json({ ok: true });
      } catch (err) {
        sendError(res, err);
      }
    },
  );

  // Promote/demote across the owner boundary (admin ⇄ t2 ⇄ t1). Always T1-only
  // — "owner can also set/unset owners" is a T1 capability in both directions,
  // and a t1's own role can never change (enforced inside `setRole`).
  app.post(
    "/admin/permissions/admins/:uid/role",
    json,
    requireCapability("manage_owners"),
    async (req: PermissionedRequest, res: Response) => {
      try {
        const role = String((req.body as { role?: unknown })?.role ?? "");
        if (role !== "t1" && role !== "t2" && role !== "admin") {
          res.status(400).json({ error: { message: 'role must be "t1", "t2", or "admin".' } });
          return;
        }
        const record = await setRole(req.uid as string, String(req.params.uid), role as AdminRole);
        res.json({ admin: record });
      } catch (err) {
        sendError(res, err);
      }
    },
  );
}
