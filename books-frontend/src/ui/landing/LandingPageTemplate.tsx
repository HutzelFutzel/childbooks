import type { ComponentType } from "react";
// The heading face the landing template asks for (`--lp-font-heading`). Loaded
// here rather than in the root layout so only landing pages (and the admin
// preview) pay for it.
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/fraunces/500-italic.css";
import "./landing.css";
import type { LandingTemplateId } from "../../core/config/landingPages";
import { StoryV1 } from "./templates/StoryV1";
import type { LandingTemplateProps } from "./templates/types";

/**
 * Template registry. A page names its renderer with `templateId`, so adding a
 * second layout is: add the id to `LANDING_TEMPLATE_IDS`, write the component,
 * register it here. Existing pages keep rendering with the template they chose.
 *
 * `Record<LandingTemplateId, …>` makes this exhaustive — an id with no renderer
 * is a compile error, not a blank page.
 */
const TEMPLATES: Record<LandingTemplateId, ComponentType<LandingTemplateProps>> = {
  "story-v1": StoryV1,
};

export function LandingPageTemplate(props: LandingTemplateProps) {
  const Template = TEMPLATES[props.page.templateId] ?? StoryV1;
  return <Template {...props} />;
}
