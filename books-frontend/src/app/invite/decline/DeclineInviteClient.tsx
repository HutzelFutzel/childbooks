"use client";

import { DeclineInvitePage } from "../../../ui/referrals/DeclineInvitePage";

export function DeclineInviteClient({ code }: { code: string }) {
  return <DeclineInvitePage code={code} />;
}
