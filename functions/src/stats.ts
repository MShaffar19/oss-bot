import { snapshot } from "./types";
import { database } from "./database";
import * as util from "./util";

const IssueFilters = {
  isOpen: (x: snapshot.Issue) => {
    return x.state === "open";
  },

  isPullRequest: (x: snapshot.Issue) => {
    return x.pull_request;
  },

  isFeatureRequest: (x: snapshot.Issue) => {
    if (!x.labels) {
      return false;
    }

    return x.labels.indexOf("type: feature request") >= 0;
  },

  isInternal: (c: snapshot.Map<boolean>) => (x: snapshot.Issue) => {
    return c[x.user.login];
  }
};

function calculateStats(issues: Array<snapshot.Issue>): IssueStats {
  const [openIss, closedIss] = util.split(issues, IssueFilters.isOpen);

  const open = openIss.length;
  const closed = closedIss.length;
  const percent_closed =
    closed === 0 ? 0 : Math.floor((closed / (closed + open)) * 100);
  const sam_score = util.samScore(open, closed);

  return {
    open,
    closed,
    percent_closed,
    sam_score
  };
}

export interface IssueStats {
  open: number;
  closed: number;
  percent_closed: number;
  sam_score: number;
}

/**
 * HTTP function for experimenting with a new SAM score.
 */
export async function getRepoIssueStats(org: string, repo: string) {
  const issuesSnap = await database()
    .ref("issues")
    .child(org)
    .child(repo)
    .once("value");
  const issueObj = issuesSnap.val() as snapshot.Map<snapshot.Issue>;

  const contributorsSnap = await database()
    .ref("repo-metadata")
    .child(org)
    .child(repo)
    .child("collaborators")
    .once("value");
  const contributors = contributorsSnap.val() as snapshot.Map<boolean>;

  // All issues and prs sorted by age
  const issuesAndPrs = Object.values(issueObj).sort((x, y) => {
    return util.timeAgo(x) - util.timeAgo(y);
  });

  // Split into filed-by-googlers and not.
  const [internal, external] = util.split(
    issuesAndPrs,
    IssueFilters.isInternal(contributors)
  );

  const [prs, issues] = util.split(issuesAndPrs, IssueFilters.isPullRequest);
  const [feature_requests, bugs] = util.split(
    issues,
    IssueFilters.isFeatureRequest
  );

  // external_bugs are the issues we care about:
  //  * Issue or PR
  //  * Not filed by a Googler
  //  * Not a feature request
  const [internal_bugs, external_bugs] = util.split(
    bugs,
    IssueFilters.isInternal(contributors)
  );

  const [internal_prs, external_prs] = util.split(
    prs,
    IssueFilters.isInternal(contributors)
  );

  const counts = {
    combined: {
      all: calculateStats(issuesAndPrs),
      internal: calculateStats(internal),
      external: calculateStats(external)
    },
    issues: {
      all: calculateStats(issues),
      feature_requests: calculateStats(feature_requests),
      bugs: calculateStats(bugs),
      external_bugs: calculateStats(external_bugs)
    },
    prs: {
      all: calculateStats(prs),
      internal: calculateStats(internal_prs),
      external: calculateStats(external_prs)
    }
  };

  return counts;
}
