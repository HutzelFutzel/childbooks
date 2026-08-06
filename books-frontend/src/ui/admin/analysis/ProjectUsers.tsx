"use client";

import { useMemo, useState } from "react";
import { Copy, Download, Search } from "lucide-react";
import { Button } from "../../components/Button";
import { Input } from "../../components/Input";
import { Select } from "../../components/Select";
import { CardHeader, CardTitle } from "../../components/Card";
import { useAdminProjects, type UserBehaviourRow } from "../../../state/adminProjectsStore";
import { downloadCsv } from "./csv";
import { fmtDuration, fmtNumber, fmtPct, fmtRelative, fmtSparks, fmtUsd } from "./format";

type UserSort = "recent" | "books" | "cost" | "net" | "rework" | "images";

const SORTS: { value: UserSort; label: string }[] = [
  { value: "recent", label: "Most recent" },
  { value: "books", label: "Most books" },
  { value: "cost", label: "Costliest" },
  { value: "net", label: "Worst net" },
  { value: "images", label: "Most images" },
  { value: "rework", label: "Most rework" },
];

function reworkRate(u: UserBehaviourRow): number {
  return u.editRate + u.variationRate;
}

function sortUsers(rows: UserBehaviourRow[], sort: UserSort): UserBehaviourRow[] {
  const copy = [...rows];
  switch (sort) {
    case "books":
      return copy.sort((a, b) => b.projects - a.projects);
    case "cost":
      return copy.sort((a, b) => b.costUsd - a.costUsd);
    case "net":
      return copy.sort((a, b) => a.netUsd - b.netUsd);
    case "images":
      return copy.sort((a, b) => b.images - a.images);
    case "rework":
      return copy.sort((a, b) => reworkRate(b) - reworkRate(a));
    default:
      return copy.sort((a, b) => b.lastActionAt - a.lastActionAt);
  }
}

/**
 * The same books, grouped by the person who made them.
 *
 * This is the level at which "is this user worth the free Sparks" is answerable:
 * one loss-making book means nothing, five in a row with a 60% regenerate rate
 * is a pattern. Clicking a row pins the whole dashboard to that user.
 */
export function ProjectUsers() {
  const users = useAdminProjects((s) => s.users);
  const loading = useAdminProjects((s) => s.loading);
  const uid = useAdminProjects((s) => s.uid);
  const setQuery = useAdminProjects((s) => s.setQuery);
  const [sort, setSort] = useState<UserSort>("recent");
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term ? users.filter((u) => u.uid.toLowerCase().includes(term)) : users;
    return sortUsers(filtered, sort);
  }, [users, search, sort]);

  return (
    <div className="rounded-2xl bg-white ring-1 ring-ink-100 shadow-soft">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3 py-3.5">
        <CardTitle className="text-sm">
          Users <span className="font-normal text-ink-400">({fmtNumber(rows.length)})</span>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-300" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="UID"
              className="h-9 w-48 pl-8 font-mono text-xs"
            />
          </div>
          <Select
            aria-label="Sort users"
            value={sort}
            onChange={(e) => setSort(e.target.value as UserSort)}
            className="h-9 w-40"
            options={SORTS}
          />
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<Download className="size-4" />}
            onClick={() => downloadCsv("book-users", rows.map((u) => ({ ...u })))}
          >
            Export CSV
          </Button>
        </div>
      </CardHeader>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-100 text-left text-xs font-medium text-ink-500">
              <th className="px-4 py-2.5">User</th>
              <th className="px-4 py-2.5 text-right">Books</th>
              <th className="px-4 py-2.5 text-right" title="Average per book">
                Pages / book
              </th>
              <th className="px-4 py-2.5 text-right" title="Average per book">
                Cast / book
              </th>
              <th className="px-4 py-2.5 text-right" title="Average per book">
                Images / book
              </th>
              <th
                className="px-4 py-2.5 text-right"
                title="Share of this user's actions that re-did something (edits + regenerates)."
              >
                Rework
              </th>
              <th className="px-4 py-2.5 text-right">Cost</th>
              <th className="px-4 py-2.5 text-right" title="Sparks charged, and how many were free">
                Sparks
              </th>
              <th className="px-4 py-2.5 text-right">Net</th>
              <th className="px-4 py-2.5">Preferred</th>
              <th className="px-4 py-2.5">Last active</th>
            </tr>
          </thead>
          <tbody className={loading ? "opacity-50" : ""}>
            {rows.map((u) => {
              const pinned = uid === u.uid;
              return (
                <tr
                  key={u.uid}
                  onClick={() => setQuery({ uid: pinned ? "" : u.uid })}
                  className={`cursor-pointer border-b border-ink-50 last:border-0 hover:bg-ink-50/40 ${
                    pinned ? "bg-brand-50/50" : ""
                  }`}
                  title={pinned ? "Click to unpin this user" : "Click to filter to this user"}
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-ink-600">{u.uid}</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          void navigator.clipboard?.writeText(u.uid);
                        }}
                        className="rounded p-0.5 text-ink-300 transition hover:bg-ink-100 hover:text-ink-600"
                        aria-label="Copy UID"
                      >
                        <Copy className="size-3" />
                      </button>
                    </div>
                    <div className="text-[10px] text-ink-400">
                      {u.ordered > 0 && <span className="text-emerald-600">{u.ordered} ordered</span>}
                      {u.ordered > 0 && u.stalled > 0 && " · "}
                      {u.stalled > 0 && <span>{u.stalled} never rendered</span>}
                      {u.medianTimeToFirstImageMs > 0 && (
                        <>
                          {(u.ordered > 0 || u.stalled > 0) && " · "}
                          first image in {fmtDuration(u.medianTimeToFirstImageMs)}
                        </>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-ink-800">
                    {fmtNumber(u.projects)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-600">
                    {u.avgPagesPerBook.toFixed(1)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-600">
                    {u.avgCastPerBook.toFixed(1)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-600">
                    {u.avgImagesPerBook.toFixed(1)}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums ${
                      reworkRate(u) > 0.5 ? "text-amber-600" : "text-ink-600"
                    }`}
                  >
                    {fmtPct(reworkRate(u))}
                    {u.failureRate > 0 && (
                      <div className="text-[10px] text-red-500">{fmtPct(u.failureRate)} failed</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">
                    {fmtUsd(u.costUsd)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink-700">
                    {fmtSparks(u.sparksCharged)}
                    {u.sparksFree > 0 && (
                      <div
                        className="text-[10px] text-ink-400"
                        title="Of the Sparks charged, how many came from grants rather than purchases."
                      >
                        {fmtSparks(u.sparksFree)} free
                      </div>
                    )}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right tabular-nums font-medium ${
                      u.netUsd >= 0 ? "text-emerald-600" : "text-red-600"
                    }`}
                  >
                    {fmtUsd(u.netUsd)}
                  </td>
                  <td className="px-4 py-2.5 text-[10px] text-ink-500">
                    {u.topTier && <div className="uppercase">{u.topTier}</div>}
                    {u.topArtStyle && <div>{u.topArtStyle}</div>}
                    {u.topModel && (
                      <div className="font-mono text-ink-300" title={u.topModel}>
                        {u.topModel.split(":").pop()}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-ink-600">{fmtRelative(u.lastActionAt)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={11} className="px-4 py-10 text-center text-sm text-ink-400">
                  No users match this selection.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
