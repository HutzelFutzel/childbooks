import type { LandingPage } from "../../../core/config/landingPages";

/** What every landing template receives. */
export interface LandingTemplateProps {
  page: LandingPage;
  /** Already sanitized — see `resolveCtaHref`. */
  ctaHref: string;
  /**
   * Rendered inside the admin editor's preview rather than as a whole page, so
   * it drops the space the fixed site header needs.
   */
  embedded?: boolean;
}
