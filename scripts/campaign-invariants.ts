/**
 * Campaign engine invariants — the properties that must hold for any campaign an
 * admin can configure, checked against the real engine rather than a restatement
 * of it.
 *
 * These are the failures that hand out money quietly: a refund floor that steps
 * over its own ceiling, a condition that a missing fact turns into a free pass, a
 * hand-edited config that pays Sparks before anyone has paid us, a public
 * projection that ships the daily budget to the browser, a holdout group that can
 * tell it's a holdout. None of them throw, none of them show up in a typecheck,
 * and all of them are only visible if you evaluate the engine at more than one
 * point.
 *
 * Run by `yarn check:campaigns`, which bundles this with esbuild first: the
 * engine lives in the Next workspace as TypeScript, and re-implementing its rules
 * in a plain .mjs check would let the check pass while the shipped code was
 * wrong.
 */
import {
  CAMPAIGN_TRIGGERS,
  CONDITION_KINDS,
  EFFECT_KINDS,
  TRIGGER_META,
  actionPriceMultiplier,
  audienceVerdict,
  campaignIsLive,
  campaignTeaser,
  campaignsConfigSchema,
  computeRefund,
  conditionAllowedForTrigger,
  conditionApplies,
  createAudience,
  createCampaign,
  createCondition,
  createEffect,
  createRule,
  describeCondition,
  describeEffect,
  describeTrigger,
  effectAllowedForTrigger,
  effectIsStanding,
  evaluateRule,
  evaluateTerms,
  freezeTerms,
  inHoldout,
  normalizeCampaignsConfig,
  notesForRules,
  publicCampaignsProjection,
  ruleNeedsApproval,
  stableFraction,
  summarizeRules,
  type Campaign,
  type RuleCondition,
  type RuleConditionKind,
  type SpendEntry,
  type SpendRefundEffect,
  type SpendScope,
  type TriggerFacts,
  type UserFacts,
} from "../books-frontend/src/core/config/campaigns";

const failures: string[] = [];
const checks: string[] = [];

function check(name: string, ok: boolean, detail?: string): void {
  if (ok) checks.push(name);
  else failures.push(`${name}${detail ? `: ${detail}` : ""}`);
}

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

function user(over: Partial<UserFacts> = {}): UserFacts {
  return {
    uid: "u1",
    anonymous: false,
    emailVerified: true,
    createdAt: NOW - 30 * DAY,
    country: "US",
    isSubscriber: false,
    planId: null,
    purchaseCount: 1,
    sparksSpent: 500,
    buyerRole: null,
    buyerRoles: [],
    surveyAnswers: [],
    arrivedVia: [],
    ...over,
  };
}

function purchase(over: Partial<TriggerFacts> = {}): TriggerFacts {
  return { trigger: "purchase", at: NOW, itemType: "print", amount: 40, ref: "pay_1", ...over };
}

function spend(over: Partial<SpendEntry> = {}): SpendEntry {
  return {
    id: "e1",
    at: NOW - DAY,
    sparks: 100,
    action: "pageIllustration",
    tier: "quick",
    projectId: "p1",
    paidSparks: 100,
    unfundedSparks: 0,
    refundedBy: null,
    ...over,
  };
}

/** A spend refund with the default caps, overridable field by field. */
function refundEffect(
  over: Partial<Omit<SpendRefundEffect, "scope">> & { scope?: Partial<SpendScope> } = {},
): SpendRefundEffect {
  const base = createEffect("spendRefund") as SpendRefundEffect;
  return { ...base, ...over, scope: { ...base.scope, ...(over.scope ?? {}) } };
}

/** Whole-account scope, which is what most of the refund maths is checked against. */
const anyProject: Partial<SpendScope> = { projects: "any" };

/**
 * A condition of each kind that actually restricts something. The blank versions
 * from `createCondition` are deliberately no-ops for some kinds (an empty country
 * list restricts nothing and describes as ""), so copy checks need the filled-in
 * form.
 */
function restrictiveCondition(kind: RuleConditionKind): RuleCondition {
  switch (kind) {
    case "hasPlan":
      return { kind, planIds: ["studio"] };
    case "country":
      return { kind, countries: ["US"] };
    case "arrivedVia":
      return { kind, tokens: ["qr:berlin-window"] };
    case "productId":
      return { kind, productIds: ["sku-1"] };
    case "surveyId":
      return { kind, surveyId: "onboarding-2026" };
    case "minAmount":
      return { kind, amount: 25 };
    case "accountAge":
      return { kind, minDays: 7, maxDays: 0 };
    case "minSparksSpent":
      return { kind, sparks: 50 };
    case "buyerRole":
      return { kind, roles: ["parent"], mode: "latest" };
    case "surveyAnswer":
      return { kind, surveyId: "profile", questionId: "audience", optionIds: ["own_child"] };
    default:
      return createCondition(kind);
  }
}

// ---- 1. Every trigger, condition and effect has customer-facing copy ---------
//
// The compiler already forces those switches to be exhaustive; what it can't
// force is that they return anything. An undescribed effect ships a campaign
// nobody can be told about, which is how a promise ends up more generous in the
// customer's head than in the config.

for (const trigger of CAMPAIGN_TRIGGERS) {
  check(`describeTrigger(${trigger}) is non-empty`, describeTrigger(trigger, 7).trim().length > 0);
}
for (const kind of EFFECT_KINDS) {
  const text = describeEffect(createEffect(kind), { plain: true });
  check(`describeEffect(${kind}) is non-empty`, text.trim().length > 0, JSON.stringify(text));
}
for (const kind of CONDITION_KINDS) {
  check(
    `describeCondition(${kind}) is non-empty when it restricts`,
    describeCondition(restrictiveCondition(kind)).trim().length > 0,
  );
}
check(
  "a campaign with no headline still has a teaser",
  campaignTeaser(createCampaign()).trim().length > 0,
);
check(
  "an explicit headline wins over the generated teaser",
  campaignTeaser(createCampaign({ presentation: { headline: "Free covers this week", subline: "" } })) ===
    "Free covers this week",
);

// ---- 2. Unknown facts never open a gate -------------------------------------
//
// The single most dangerous failure mode is a campaign that pays out because a
// field was missing. Every condition must FAIL on an unknown, not pass.

check(
  "unknown country fails a country condition",
  conditionApplies({ kind: "country", countries: ["US"] }, user({ country: null }), purchase()) !== null,
);
check(
  "unknown item type fails an itemType condition",
  conditionApplies({ kind: "itemType", items: ["print"] }, user(), purchase({ itemType: undefined })) !== null,
);
check(
  "missing product fails a productId condition",
  conditionApplies({ kind: "productId", productIds: ["x"] }, user(), purchase({ productId: undefined })) !== null,
);
check(
  "missing plan fails a hasPlan condition",
  conditionApplies({ kind: "hasPlan", planIds: ["studio"] }, user({ planId: null }), purchase()) !== null,
);
check(
  "missing invoice number fails an nthInvoice condition",
  conditionApplies({ kind: "nthInvoice", min: 2 }, user(), purchase({ invoiceNumber: undefined })) !== null,
);
check(
  "missing amount fails a minAmount condition",
  conditionApplies({ kind: "minAmount", amount: 25 }, user(), purchase({ amount: undefined })) !== null,
);
check(
  "an unverified email fails an emailVerified condition",
  conditionApplies({ kind: "emailVerified" }, user({ emailVerified: false }), purchase()) !== null,
);
// Survey-derived facts are the emptiest facts we have — most accounts have never
// answered anything — so a targeting rule built on them has to read as "nobody
// yet" rather than "everybody".
check(
  "a silent account fails a buyerRole condition (latest)",
  conditionApplies({ kind: "buyerRole", roles: ["parent"], mode: "latest" }, user(), purchase()) !== null,
);
check(
  "a silent account fails a buyerRole condition (ever)",
  conditionApplies({ kind: "buyerRole", roles: ["parent"], mode: "ever" }, user(), purchase()) !== null,
);
// An account with no recorded arrival is the common case (most visits are
// direct), so a campaign targeted at a QR poster must read as "not them" rather
// than "everybody".
check(
  "an account with no recorded arrival fails an arrivedVia condition",
  conditionApplies({ kind: "arrivedVia", tokens: ["qr:berlin-window"] }, user(), purchase()) !== null,
);
check(
  "an arrivedVia condition matches the account that scanned it",
  conditionApplies(
    { kind: "arrivedVia", tokens: ["qr:berlin-window"] },
    user({ arrivedVia: ["qr:berlin-window"] }),
    purchase(),
  ) === null,
);
check(
  "an empty arrivedVia condition restricts nothing",
  conditionApplies({ kind: "arrivedVia", tokens: [] }, user(), purchase()) === null,
);
check(
  "an arrivedVia refusal doesn't quote the customer's own source back at them",
  !/berlin/i.test(describeCondition({ kind: "arrivedVia", tokens: ["qr:berlin-window"] })),
  describeCondition({ kind: "arrivedVia", tokens: ["qr:berlin-window"] }),
);
check(
  "a silent account fails a surveyAnswer condition",
  conditionApplies(
    { kind: "surveyAnswer", surveyId: "profile", questionId: "audience", optionIds: ["own_child"] },
    user(),
    purchase(),
  ) !== null,
);
// The point of keeping the whole role history: a parent shopping for a friend is
// still a parent, and that's the audience worth naming.
check(
  "buyerRole 'ever' still matches after the latest order moved on",
  conditionApplies(
    { kind: "buyerRole", roles: ["parent"], mode: "ever" },
    user({ buyerRole: "friend", buyerRoles: ["parent", "friend"] }),
    purchase(),
  ) === null,
);
check(
  "buyerRole 'latest' does not match a role they've moved on from",
  conditionApplies(
    { kind: "buyerRole", roles: ["parent"], mode: "latest" },
    user({ buyerRole: "friend", buyerRoles: ["parent", "friend"] }),
    purchase(),
  ) !== null,
);
check(
  "a surveyAnswer condition matches on survey:question:option, not option alone",
  conditionApplies(
    { kind: "surveyAnswer", surveyId: "profile", questionId: "audience", optionIds: ["own_child"] },
    user({ surveyAnswers: ["other:audience:own_child"] }),
    purchase(),
  ) !== null,
);
// An unfinished condition in the editor must not quietly become a gate that
// nobody passes — half-typed rules are saved constantly.
check(
  "an empty buyerRole condition restricts nothing",
  conditionApplies({ kind: "buyerRole", roles: [], mode: "latest" }, user(), purchase()) === null,
);
check(
  "a surveyAnswer condition with no options restricts nothing",
  conditionApplies(
    { kind: "surveyAnswer", surveyId: "profile", questionId: "audience", optionIds: [] },
    user(),
    purchase(),
  ) === null,
);

// ---- 3. Conditions are ANDed, and a rule reports every failure ---------------

{
  const rule = createRule({
    trigger: "purchase",
    conditions: [
      { kind: "itemType", items: ["print"] },
      { kind: "minAmount", amount: 100 },
      { kind: "isSubscriber", value: true },
    ],
  });
  const evaluation = evaluateRule(rule, user(), purchase({ amount: 40 }));
  check("a rule with any failing condition does not match", !evaluation.matched);
  check(
    "a rule reports EVERY failure, not just the first",
    evaluation.failures.length === 2,
    `got ${evaluation.failures.length}`,
  );
  check(
    "every failure carries a reason a human can read",
    evaluation.failures.every((f) => f.reason.trim().length > 0),
  );

  const passing = evaluateRule(
    createRule({ trigger: "purchase", conditions: [{ kind: "itemType", items: ["print"] }] }),
    user(),
    purchase(),
  );
  check("a rule with all conditions satisfied matches", passing.matched);
  check("a matching rule has no failures", passing.failures.length === 0);
}

// ---- 4. Refund maths: caps bind, and the floor never steps over a ceiling ----

{
  const entries = [spend({ id: "a" }), spend({ id: "b", sparks: 300, paidSparks: 300 })];

  const uncapped = computeRefund({
    entries,
    effect: refundEffect({ percent: 100, maxRefundSparks: 0, maxPctOfPurchase: 0, scope: anyProject }),
    enrolledAt: NOW - 10 * DAY,
    sparkValueUsd: 0.02,
  });
  check("an uncapped refund returns all qualifying spend", uncapped.sparks === 400, `got ${uncapped.sparks}`);
  check("a refund names the entries it consumed", uncapped.entryIds.join(",") === "a,b");

  const capped = computeRefund({
    entries,
    effect: refundEffect({ percent: 100, maxRefundSparks: 150, maxPctOfPurchase: 0, scope: anyProject }),
    enrolledAt: NOW - 10 * DAY,
    sparkValueUsd: 0.02,
  });
  check("the Spark ceiling binds", capped.sparks === 150, `got ${capped.sparks}`);
  check("the Spark ceiling is reported", capped.cappedBy === "sparks", capped.cappedBy);

  // A 4-unit purchase at 10% is 0.40; at $0.02/Spark that's 20 Sparks, well under
  // the 400 the percentage alone would have paid.
  const byPurchase = computeRefund({
    entries,
    effect: refundEffect({ percent: 100, maxRefundSparks: 0, maxPctOfPurchase: 10, scope: anyProject }),
    enrolledAt: NOW - 10 * DAY,
    purchaseAmount: 4,
    sparkValueUsd: 0.02,
  });
  check("the share-of-purchase ceiling binds", byPurchase.sparks === 20, `got ${byPurchase.sparks}`);
  check("the purchase ceiling is reported", byPurchase.cappedBy === "purchase", byPurchase.cappedBy);

  // The one that would quietly cost real money: a 500-Spark "minimum refund" on a
  // campaign capped at 150 must not pay 500.
  const floorVsCeiling = computeRefund({
    entries: [spend({ sparks: 10, paidSparks: 10 })],
    effect: refundEffect({
      percent: 10,
      maxRefundSparks: 150,
      maxPctOfPurchase: 0,
      minRefundSparks: 500,
      minRefundMode: "topUp",
      scope: anyProject,
    }),
    enrolledAt: NOW - 10 * DAY,
    sparkValueUsd: 0.02,
  });
  check(
    "a top-up floor never exceeds the Spark ceiling",
    floorVsCeiling.sparks <= 150,
    `paid ${floorVsCeiling.sparks} against a 150 cap`,
  );

  const skipped = computeRefund({
    entries: [spend({ sparks: 10, paidSparks: 10 })],
    effect: refundEffect({
      percent: 10,
      maxRefundSparks: 150,
      minRefundSparks: 50,
      minRefundMode: "skip",
      scope: anyProject,
    }),
    enrolledAt: NOW - 10 * DAY,
    sparkValueUsd: 0.02,
  });
  check("a 'skip' floor pays nothing below the minimum", skipped.sparks === 0, `got ${skipped.sparks}`);
  check("a zero refund consumes no ledger entries", skipped.entryIds.length === 0);
}

// ---- 5. Refunds never mint value --------------------------------------------

{
  const cases: Array<[string, ReturnType<typeof computeRefund>]> = [
    [
      "unfunded spend is never refunded",
      computeRefund({
        entries: [spend({ sparks: 100, paidSparks: 0, unfundedSparks: 100 })],
        effect: refundEffect({ percent: 100, scope: { ...anyProject, funding: "all" } }),
        enrolledAt: NOW - 10 * DAY,
        sparkValueUsd: 0.02,
      }),
    ],
    [
      "spend already refunded by another campaign is skipped",
      computeRefund({
        entries: [spend({ refundedBy: "some-other-campaign" })],
        effect: refundEffect({ percent: 100, scope: anyProject }),
        enrolledAt: NOW - 10 * DAY,
        sparkValueUsd: 0.02,
      }),
    ],
    [
      "'purchased only' ignores Sparks that were given away",
      computeRefund({
        entries: [spend({ sparks: 100, paidSparks: 0, unfundedSparks: 0 })],
        effect: refundEffect({ percent: 100, scope: { ...anyProject, funding: "purchased" } }),
        enrolledAt: NOW - 10 * DAY,
        sparkValueUsd: 0.02,
      }),
    ],
    [
      "a tier-scoped refund ignores other tiers",
      computeRefund({
        entries: [spend({ tier: "premium" })],
        effect: refundEffect({ percent: 100, scope: { ...anyProject, tiers: ["quick"] } }),
        enrolledAt: NOW - 10 * DAY,
        sparkValueUsd: 0.02,
      }),
    ],
    [
      "an action-scoped refund ignores other actions",
      computeRefund({
        entries: [spend({ action: "coverIllustration" })],
        effect: refundEffect({ percent: 100, scope: { ...anyProject, actions: ["pageIllustration"] } }),
        enrolledAt: NOW - 10 * DAY,
        sparkValueUsd: 0.02,
      }),
    ],
    [
      "a project-scoped refund ignores other projects",
      computeRefund({
        entries: [spend({ projectId: "other" })],
        effect: refundEffect({ percent: 100, scope: { projects: "purchasedProject" } }),
        enrolledAt: NOW - 10 * DAY,
        purchasedProjectId: "p1",
        sparkValueUsd: 0.02,
      }),
    ],
    [
      "'since enrollment' ignores earlier spend",
      computeRefund({
        entries: [spend({ at: NOW - 60 * DAY })],
        effect: refundEffect({ percent: 100, scope: { ...anyProject, sinceEnrollment: true } }),
        enrolledAt: NOW - 10 * DAY,
        sparkValueUsd: 0.02,
      }),
    ],
    [
      "a project-scoped refund pays nothing when no project is known",
      computeRefund({
        entries: [spend()],
        effect: refundEffect({ percent: 100, scope: { projects: "purchasedProject" } }),
        enrolledAt: NOW - 10 * DAY,
        purchasedProjectId: null,
        sparkValueUsd: 0.02,
      }),
    ],
  ];
  for (const [name, result] of cases) {
    check(name, result.sparks === 0, `paid ${result.sparks}`);
    check(`${name} (and consumes nothing)`, result.entryIds.length === 0);
  }

  // Monotonicity: more qualifying spend can never mean a smaller refund.
  let previous = -1;
  let monotone = true;
  for (const sparks of [10, 50, 100, 500, 5000]) {
    const out = computeRefund({
      entries: [spend({ sparks, paidSparks: sparks })],
      effect: refundEffect({ percent: 50, maxRefundSparks: 1000, maxPctOfPurchase: 0, scope: anyProject }),
      enrolledAt: NOW - 10 * DAY,
      sparkValueUsd: 0.02,
    });
    if (out.sparks < previous) monotone = false;
    previous = out.sparks;
  }
  check("refunds are monotone in qualifying spend", monotone);
}

// ---- 6. Trigger/effect compatibility is total and consistent ----------------

{
  let everyTriggerHasAnEffect = true;
  for (const trigger of CAMPAIGN_TRIGGERS) {
    if (!EFFECT_KINDS.some((kind) => effectAllowedForTrigger(trigger, kind))) {
      everyTriggerHasAnEffect = false;
      failures.push(`trigger "${trigger}" can carry no effect at all`);
    }
  }
  check("every trigger can carry at least one effect", everyTriggerHasAnEffect);

  let standingIsExclusive = true;
  for (const trigger of CAMPAIGN_TRIGGERS) {
    for (const kind of EFFECT_KINDS) {
      if (!effectAllowedForTrigger(trigger, kind)) continue;
      const standingTrigger = TRIGGER_META[trigger].standing;
      // A standing effect needs a standing trigger. A standing trigger can only
      // carry a delivered effect if it's the one that costs nothing until it's
      // redeemed — a discount.
      if (effectIsStanding(kind) !== standingTrigger && kind !== "purchaseDiscount") {
        standingIsExclusive = false;
        failures.push(`"${kind}" is allowed on "${trigger}", which mixes standing and delivered effects`);
      }
    }
  }
  check("standing effects only ride standing triggers, and vice versa", standingIsExclusive);

  let sparksBeforePaymentNeedApproval = true;
  for (const trigger of CAMPAIGN_TRIGGERS) {
    if (!TRIGGER_META[trigger].prePayment) continue;
    for (const kind of ["sparks", "spendRefund"] as const) {
      if (!effectAllowedForTrigger(trigger, kind)) continue;
      if (!ruleNeedsApproval(trigger, kind)) {
        sparksBeforePaymentNeedApproval = false;
        failures.push(`"${kind}" pays automatically on "${trigger}", before any money has moved`);
      }
    }
  }
  check("handing over Sparks before any payment always needs approval", sparksBeforePaymentNeedApproval);
  check("feedback always needs approval", ruleNeedsApproval("feedback_submitted", "purchaseDiscount"));
  check(
    "a spend refund can only hang off something that was paid for",
    !effectAllowedForTrigger("signup", "spendRefund") && effectAllowedForTrigger("purchase", "spendRefund"),
  );
}

// ---- 7. Normalization can't be talked past, and is idempotent ----------------

{
  const hostile = {
    version: 1,
    enabled: true,
    campaigns: [
      {
        id: "c1",
        name: "Hand-edited",
        status: "active",
        window: { startsAt: 0, endsAt: 0 },
        rules: [
          // Sparks on signup with approval switched OFF — exactly what a
          // hand-edited Firestore doc would try. Plus a condition signup can
          // never evaluate.
          {
            id: "r1",
            enabled: true,
            trigger: "signup",
            conditions: [{ kind: "itemType", items: ["print"] }],
            effect: { kind: "sparks", sparks: 5000, expiresInDays: 0 },
            afterDays: 7,
            maxPerAccount: 0,
            requiresApproval: false,
          },
          // A standing price override on a delivered trigger.
          {
            id: "r2",
            enabled: true,
            trigger: "purchase",
            conditions: [],
            effect: { kind: "actionPricing", actions: [], tiers: [], mode: "free", multiplier: 1 },
            afterDays: 1,
            maxPerAccount: 1,
            requiresApproval: false,
          },
          // A duplicate id: two rules collapsed onto one payout key.
          {
            id: "r1",
            enabled: true,
            trigger: "purchase",
            conditions: [],
            effect: { kind: "sparks", sparks: 10, expiresInDays: 30 },
            afterDays: 1,
            maxPerAccount: 1,
            requiresApproval: false,
          },
        ],
      },
    ],
  };
  const normalized = normalizeCampaignsConfig(hostile, NOW);
  const campaign = normalized.campaigns[0];
  check("normalization forces approval on a pre-payment Spark grant", campaign.rules[0].requiresApproval);
  check(
    "normalization drops a condition the trigger can never evaluate",
    campaign.rules[0].conditions.length === 0,
    JSON.stringify(campaign.rules[0].conditions),
  );
  check("normalization disables an effect the trigger can't carry", campaign.rules[1].enabled === false);
  check(
    "normalization de-duplicates rule ids",
    new Set(campaign.rules.map((r) => r.id)).size === campaign.rules.length,
    campaign.rules.map((r) => r.id).join(","),
  );
  check(
    "normalization is idempotent",
    JSON.stringify(normalizeCampaignsConfig(normalized, NOW)) === JSON.stringify(normalized),
  );
  check(
    "an absent config normalizes to a no-op rather than throwing",
    normalizeCampaignsConfig(undefined, NOW).campaigns.length === 0 &&
      normalizeCampaignsConfig(undefined, NOW).enabled === false,
  );
  check(
    "garbage normalizes to a no-op",
    normalizeCampaignsConfig({ campaigns: "nope", enabled: "yes" }, NOW).campaigns.length === 0,
  );

  // A closed window can't read as active, however it was stored.
  const stale = normalizeCampaignsConfig(
    {
      version: 1,
      enabled: true,
      campaigns: [{ ...hostile.campaigns[0], status: "active", window: { startsAt: 0, endsAt: NOW - DAY } }],
    },
    NOW,
  );
  check("a campaign past its window normalizes to 'ended'", stale.campaigns[0].status === "ended");
  check("an ended campaign isn't live", !campaignIsLive(stale.campaigns[0], NOW));
}

// ---- 8. Every allowed condition survives normalization ----------------------
//
// The mirror of check 7: a condition the trigger DOES allow must never be
// dropped, or an admin's restriction quietly stops applying.

{
  let allSurvive = true;
  for (const kind of CONDITION_KINDS) {
    for (const trigger of CAMPAIGN_TRIGGERS) {
      if (!conditionAllowedForTrigger(trigger, kind)) continue;
      const normalized = normalizeCampaignsConfig(
        {
          version: 1,
          enabled: true,
          campaigns: [
            {
              id: "c",
              name: "n",
              status: "draft",
              rules: [
                {
                  id: "r",
                  enabled: true,
                  trigger,
                  conditions: [restrictiveCondition(kind)],
                  effect: createEffect("purchaseDiscount"),
                  afterDays: 7,
                  maxPerAccount: 1,
                  requiresApproval: true,
                },
              ],
            },
          ],
        },
        NOW,
      );
      const kept = normalized.campaigns[0]?.rules[0]?.conditions ?? [];
      if (!kept.some((c) => c.kind === kind)) {
        allSurvive = false;
        failures.push(`condition "${kind}" was dropped on allowed trigger "${trigger}"`);
      }
    }
  }
  check("every trigger-compatible condition survives normalization", allSurvive);
}

// ---- 9. The save-time schema refuses the expensive mistakes -----------------

function rejects(name: string, campaign: Partial<Campaign>): void {
  const result = campaignsConfigSchema.safeParse({
    version: 1,
    enabled: true,
    campaigns: [createCampaign({ status: "active", ...campaign })],
  });
  check(`schema rejects ${name}`, !result.success);
  if (!result.success) {
    check(
      `the refusal of ${name} explains itself`,
      result.error.issues.every((i) => i.message.trim().length > 20),
      result.error.issues.map((i) => i.message).join(" | "),
    );
  }
}

const budget = { maxPerAccount: 1, maxTotal: 0, dailyBudget: 250, lifetimeBudget: 0 };

rejects("an uncapped spend refund", {
  limits: budget,
  rules: [
    createRule({
      trigger: "purchase",
      effect: refundEffect({ maxRefundSparks: 0, maxPctOfPurchase: 0 }),
    }),
  ],
});

rejects("a refund of 100% of ALL Sparks with no purchase cap", {
  limits: budget,
  rules: [
    createRule({
      trigger: "purchase",
      effect: refundEffect({ percent: 100, maxRefundSparks: 500, maxPctOfPurchase: 0, scope: { funding: "all" } }),
    }),
  ],
});

rejects("a minimum refund above the maximum", {
  limits: budget,
  rules: [
    createRule({
      trigger: "purchase",
      effect: refundEffect({ minRefundSparks: 900, minRefundMode: "topUp", maxRefundSparks: 500 }),
    }),
  ],
});

rejects("a Spark grant with no daily budget", {
  limits: { ...budget, dailyBudget: 0 },
  rules: [createRule({ trigger: "purchase", effect: createEffect("sparks") })],
});

rejects("an auto-paying feedback reward", {
  limits: budget,
  rules: [
    createRule({
      trigger: "feedback_submitted",
      effect: createEffect("purchaseDiscount"),
      requiresApproval: false,
    }),
  ],
});

rejects("a price override on a purchase", {
  limits: budget,
  rules: [createRule({ trigger: "purchase", effect: createEffect("actionPricing") })],
});

rejects("a Spark grant on a standing trigger", {
  limits: budget,
  rules: [createRule({ trigger: "always", effect: createEffect("sparks"), requiresApproval: true })],
});

rejects("a window that ends before it starts", {
  window: { startsAt: NOW, endsAt: NOW - DAY },
  limits: budget,
  rules: [createRule({ trigger: "purchase", effect: createEffect("purchaseDiscount") })],
});

rejects("a signup window that ends before it starts", {
  audience: { ...createAudience(), signedUpFrom: NOW, signedUpTo: NOW - DAY },
  limits: budget,
  rules: [createRule({ trigger: "purchase", effect: createEffect("purchaseDiscount") })],
});

rejects("'every renewal' on something that isn't a membership", {
  limits: budget,
  rules: [
    createRule({
      trigger: "purchase",
      effect: { kind: "purchaseDiscount", percentOff: 10, appliesTo: ["print"], expiresInDays: 30, recurring: true },
    }),
  ],
});

rejects("two rules sharing an id", {
  limits: budget,
  rules: [
    createRule({ id: "same", trigger: "purchase", effect: createEffect("purchaseDiscount") }),
    createRule({ id: "same", trigger: "purchase", effect: createEffect("purchaseDiscount") }),
  ],
});

rejects("an active campaign with no enabled rules", {
  limits: budget,
  rules: [createRule({ trigger: "purchase", effect: createEffect("purchaseDiscount"), enabled: false })],
});

{
  // The positive control. Without it, every guard above could be satisfied by a
  // schema that refuses everything.
  const sane = createCampaign({
    status: "active",
    limits: { maxPerAccount: 1, maxTotal: 100, dailyBudget: 250, lifetimeBudget: 5000 },
    rules: [
      createRule({
        id: "welcome-refund",
        trigger: "purchase",
        conditions: [
          { kind: "itemType", items: ["print"] },
          { kind: "firstPurchase", value: true },
        ],
        effect: refundEffect({ percent: 100, maxRefundSparks: 500, maxPctOfPurchase: 50 }),
      }),
    ],
  });
  const result = campaignsConfigSchema.safeParse({ version: 1, enabled: true, campaigns: [sane] });
  check(
    "schema accepts a well-formed campaign",
    result.success,
    result.success ? "" : JSON.stringify(result.error.issues.map((i) => i.message)),
  );
  check(
    "schema accepts an empty config",
    campaignsConfigSchema.safeParse({ version: 1, enabled: false, campaigns: [] }).success,
  );
}

// ---- 10. The public projection leaks nothing --------------------------------

{
  const config = normalizeCampaignsConfig(
    {
      version: 1,
      enabled: true,
      campaigns: [
        {
          ...createCampaign({
            id: "live",
            status: "active",
            notes: "internal reasoning about margin",
            limits: { maxPerAccount: 1, maxTotal: 0, dailyBudget: 999, lifetimeBudget: 12345 },
          }),
          audience: { ...createAudience(), allowlistUids: ["secret-uid"] },
        },
        createCampaign({ id: "wip", status: "draft" }),
      ],
    },
    NOW,
  );
  const projection = publicCampaignsProjection(config);
  const serialized = JSON.stringify(projection);
  check("the public projection hides allowlisted accounts", !serialized.includes("secret-uid"));
  check("the public projection hides admin notes", !serialized.includes("internal reasoning"));
  // Checked structurally rather than by searching the JSON for "999": rule ids are
  // random, so a substring check passes or fails depending on the ids generated in
  // that run.
  check("the public projection hides the daily budget", projection.campaigns[0]?.limits.dailyBudget === 0);
  check(
    "the public projection hides the lifetime budget",
    projection.campaigns[0]?.limits.lifetimeBudget === 0,
  );
  check("the public projection omits drafts", !serialized.includes("wip"));
  check(
    "the public projection keeps the rules the client needs to preview an offer",
    projection.campaigns[0]?.rules.length === config.campaigns[0].rules.length,
  );
  check(
    "projecting twice changes nothing",
    JSON.stringify(publicCampaignsProjection(projection)) === serialized,
  );
}

// ---- 11. Holdout assignment is stable, deterministic and roughly right ------

{
  const campaign = createCampaign({ id: "camp-x", holdoutPct: 20 });
  const uids = Array.from({ length: 5000 }, (_, i) => `user-${i}`);
  const pct = (uids.filter((uid) => inHoldout(campaign, uid)).length / uids.length) * 100;
  check("a 20% holdout lands within 3 points of 20%", Math.abs(pct - 20) < 3, `got ${pct.toFixed(1)}%`);
  check(
    "holdout assignment is stable across calls",
    uids.every((uid) => inHoldout(campaign, uid) === inHoldout(campaign, uid)),
  );
  check("a 0% holdout holds nobody", !uids.some((uid) => inHoldout(createCampaign({ id: "y", holdoutPct: 0 }), uid)));
  check(
    "a 100% holdout holds everybody",
    uids.every((uid) => inHoldout(createCampaign({ id: "z", holdoutPct: 100 }), uid)),
  );
  check(
    "different campaigns assign different holdouts",
    uids.filter((uid) => inHoldout(campaign, uid)).join() !==
      uids.filter((uid) => inHoldout(createCampaign({ id: "camp-w", holdoutPct: 20 }), uid)).join(),
  );
  check(
    "campaigns with near-identical ids assign INDEPENDENT holdouts",
    // The failure this guards against isn't correlation for its own sake: two 50%
    // splits that agree would mean one half of the customer base is the control
    // group for everything and the other half is treated by everything, so no
    // campaign's measured lift is about that campaign. Ids differing only in the
    // last character are the realistic case ("promo-1", "promo-2").
    (() => {
      const a = uids.map((uid) => inHoldout(createCampaign({ id: "promo-1", holdoutPct: 50 }), uid));
      const b = uids.map((uid) => inHoldout(createCampaign({ id: "promo-2", holdoutPct: 50 }), uid));
      const agree = a.filter((x, i) => x === b[i]).length / a.length;
      return agree > 0.45 && agree < 0.55;
    })(),
  );
  check(
    "the hash stays inside [0,1)",
    uids.every((uid) => {
      const f = stableFraction(uid, "salt");
      return f >= 0 && f < 1;
    }),
  );

  // A holdout that can tell it's a holdout isn't a control group any more, so the
  // reason it's shown has to be word-for-word the one everyone else sees.
  const held = uids.find((uid) => inHoldout(createCampaign({ id: "camp-x", holdoutPct: 20 }), uid)) ?? "user-0";
  const holdout = audienceVerdict(createCampaign({ id: "camp-x", status: "active", holdoutPct: 20 }), user({ uid: held }), NOW);
  const notRunning = audienceVerdict(createCampaign({ id: "camp-x", status: "paused" }), user(), NOW);
  check("a holdout is recorded as a holdout", holdout.holdout && !holdout.eligible);
  check("a holdout can't tell it's a holdout", holdout.reason === notRunning.reason, `${holdout.reason} vs ${notRunning.reason}`);
}

// ---- 12. Audience gates deny unknowns and explain themselves ----------------

{
  const live = createCampaign({ id: "aud", status: "active" });
  const verdicts: Array<[string, ReturnType<typeof audienceVerdict>]> = [
    ["a guest can't enroll by default", audienceVerdict(live, user({ anonymous: true }), NOW)],
    ["an unverified email can't enroll by default", audienceVerdict(live, user({ emailVerified: false }), NOW)],
    [
      "an unknown country can't enroll into a geo-limited campaign",
      audienceVerdict(
        createCampaign({ id: "geo", status: "active", audience: { ...createAudience(), countries: ["US"] } }),
        user({ country: null }),
        NOW,
      ),
    ],
    [
      "someone off the allowlist can't enroll",
      audienceVerdict(
        createCampaign({ id: "allow", status: "active", audience: { ...createAudience(), allowlistUids: ["someone-else"] } }),
        user(),
        NOW,
      ),
    ],
    ["a draft campaign enrolls nobody", audienceVerdict(createCampaign({ id: "draft" }), user(), NOW)],
    [
      "a campaign that hasn't opened yet enrolls nobody",
      audienceVerdict(createCampaign({ id: "future", status: "active", window: { startsAt: NOW + DAY, endsAt: 0 } }), user(), NOW),
    ],
  ];
  for (const [name, verdict] of verdicts) {
    check(name, !verdict.eligible);
    check(`${name} (with a reason worth showing)`, (verdict.reason ?? "").trim().length > 0, verdict.reason ?? "null");
  }
  check("an eligible account is eligible", audienceVerdict(live, user(), NOW).eligible);
  check("an eligible account has nothing to explain", audienceVerdict(live, user(), NOW).reason === null);
}

// ---- 13. Price overrides pick the best offer and never raise a price --------

{
  const free = createRule({
    id: "free",
    trigger: "always",
    effect: { kind: "actionPricing", actions: [], tiers: ["quick"], mode: "free", multiplier: 1 },
  });
  const half = createRule({
    id: "half",
    trigger: "always",
    effect: { kind: "actionPricing", actions: [], tiers: ["quick"], mode: "multiplier", multiplier: 0.5 },
  });
  check("no rules means no change", actionPriceMultiplier([], "pageIllustration", "quick") === 1);
  check("the most generous override wins", actionPriceMultiplier([half, free], "pageIllustration", "quick") === 0);
  check(
    "order doesn't decide the winner",
    actionPriceMultiplier([free, half], "pageIllustration", "quick") ===
      actionPriceMultiplier([half, free], "pageIllustration", "quick"),
  );
  check("an out-of-scope tier is untouched", actionPriceMultiplier([free, half], "pageIllustration", "premium") === 1);
  check("a disabled rule is ignored", actionPriceMultiplier([{ ...free, enabled: false }], "pageIllustration", "quick") === 1);
  check(
    "a delivered trigger can't change a price",
    actionPriceMultiplier([{ ...free, trigger: "purchase" }], "pageIllustration", "quick") === 1,
  );
  check(
    "an action-scoped override doesn't reach other actions",
    actionPriceMultiplier(
      [createRule({ trigger: "always", effect: { kind: "actionPricing", actions: ["anchorImage"], tiers: [], mode: "free", multiplier: 1 } })],
      "pageIllustration",
      "quick",
    ) === 1,
  );
  check(
    "an override can never raise a price",
    actionPriceMultiplier(
      [createRule({ trigger: "always", effect: { kind: "actionPricing", actions: [], tiers: [], mode: "multiplier", multiplier: 4 } })],
      "pageIllustration",
      "quick",
    ) <= 1,
  );
}

// ---- 14. Frozen terms are a real snapshot ----------------------------------

{
  const campaign = createCampaign({
    status: "active",
    rules: [
      createRule({ id: "keep", trigger: "purchase", effect: createEffect("purchaseDiscount") }),
      createRule({ id: "off", trigger: "purchase", effect: createEffect("purchaseDiscount"), enabled: false }),
    ],
  });
  const terms = freezeTerms(campaign, NOW);
  check("freezing keeps only enabled rules", terms.rules.length === 1 && terms.rules[0].id === "keep");
  check("freezing captures the customer-facing summary", terms.summary.trim().length > 0);

  // Editing the campaign afterwards must not reach the frozen copy — that is the
  // entire point of freezing.
  campaign.rules[0].effect = createEffect("sparks");
  campaign.limits.maxPerAccount = 99;
  check("frozen terms don't follow later effect edits", terms.rules[0].effect.kind === "purchaseDiscount");
  check("frozen terms don't follow later limit edits", terms.limits.maxPerAccount !== 99);

  const evaluation = evaluateTerms(terms, user(), purchase());
  check("a frozen snapshot still evaluates", evaluation.matched.length === 1);
  check(
    "a disabled rule can't be revived through a snapshot",
    evaluation.evaluations.every((e) => e.ruleId !== "off"),
  );
  check(
    "a snapshot ignores events its rules don't listen for",
    evaluateTerms(terms, user(), { trigger: "signup", at: NOW }).matched.length === 0,
  );
}

// ---- 15. Generated copy is complete and de-duplicated ----------------------

{
  const rules = [
    createRule({
      id: "a",
      trigger: "purchase",
      conditions: [{ kind: "itemType", items: ["print"] }, { kind: "emailVerified" }],
      effect: refundEffect({ percent: 10, maxRefundSparks: 300, maxPctOfPurchase: 25 }),
    }),
    createRule({
      id: "b",
      trigger: "purchase",
      conditions: [{ kind: "emailVerified" }],
      effect: createEffect("sparks"),
    }),
  ];
  const summary = summarizeRules(rules);
  check("a summary covers the refund", summary.includes("back as Sparks"), summary);
  check("a summary covers the Spark grant", summary.includes("50 Sparks"), summary);
  // Capitalized (or starting on a number), one full stop, and the moment the
  // reward lands stated once rather than once per rule.
  check("a summary reads as a sentence", /^[A-Z0-9].*\.$/.test(summary), summary);
  check(
    "a summary states a shared trigger only once",
    summary.split("when your order is complete").length === 2,
    summary,
  );
  check(
    "a summary keeps distinct triggers apart",
    (() => {
      const mixed = summarizeRules([
        rules[0],
        createRule({ id: "c", trigger: "signup", effect: createEffect("purchaseDiscount") }),
      ]);
      return mixed.includes("when your order is complete") && mixed.includes("when you create your account");
    })(),
  );
  check("a rule set with nothing enabled summarizes to nothing", summarizeRules([{ ...rules[0], enabled: false }]) === "");

  const notes = notesForRules(rules);
  check("caveats are de-duplicated across rules", new Set(notes).size === notes.length, notes.join(" | "));
  check("a refund's Spark cap is disclosed", notes.some((n) => n.includes("300")), notes.join(" | "));
  check("a refund's purchase cap is disclosed", notes.some((n) => n.includes("25%")), notes.join(" | "));
  check(
    "a Spark grant's expiry is disclosed",
    notes.some((n) => n.includes("180 days")),
    notes.join(" | "),
  );
  check(
    "an approval hold is disclosed",
    notesForRules([createRule({ trigger: "feedback_submitted", effect: createEffect("purchaseDiscount") })]).some((n) =>
      n.includes("by hand"),
    ),
  );
  check(
    "a 'skip' floor is disclosed",
    notesForRules([
      createRule({
        trigger: "purchase",
        effect: refundEffect({ minRefundSparks: 40, minRefundMode: "skip" }),
      }),
    ]).some((n) => n.includes("40")),
  );
}

// ---- Report -----------------------------------------------------------------

console.log(`${checks.length} invariant(s) held.`);
if (failures.length > 0) {
  console.error(`\n${failures.length} invariant(s) FAILED:`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exitCode = 1;
} else {
  console.log("All campaign invariants hold.");
}
