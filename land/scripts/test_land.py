from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


LAND = Path(__file__).resolve().parent / "land"
NEW_HEAD = "a" * 40
CI = ".github/workflows/ci.yml"


def check(name="check", status="COMPLETED", conclusion="SUCCESS", run=1):
    return {"__typename": "CheckRun", "name": name, "status": status, "conclusion": conclusion,
            "workflowName": "CI", "detailsUrl": f"https://github.com/test/repo/actions/runs/{run}/job/9",
            "completedAt": "2026-01-01T00:00:00Z"}


class LandTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="land-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.checkout = self.root / "repo"
        self.checkout.mkdir()
        self.mock = self.root / "bin"
        self.mock.mkdir()
        self.env = dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_NOSYSTEM="1",
                        PATH=f"{self.mock}:{os.environ['PATH']}", LC_ALL="C",
                        GH_FIXTURE=str(self.root / "pr.json"), GH_GITHUB=str(self.root / "github.json"),
                        GH_CALLS=str(self.root / "calls"), LAND_POLL_SECONDS="0")
        self.git("init", "-b", "trunk")
        self.git("config", "user.name", "Test")
        self.git("config", "user.email", "test@example.invalid")
        (self.checkout / "tracked").write_text("base\n")
        self.git("add", ".")
        self.git("commit", "-m", "base")
        self.git("switch", "-c", "feature/topic")
        (self.checkout / "tracked").write_text("feature\n")
        self.git("commit", "-am", "feature")
        head = self.git("rev-parse", "HEAD").stdout.strip()
        self.git("switch", "trunk")
        self.git("merge", "--squash", "feature/topic")
        self.git("commit", "-m", "squashed feature")
        self.pr = dict(number=123, url="https://github.com/test/repo/pull/123", state="MERGED",
                       headRefName="feature/topic", headRefOid=head, baseRefName="trunk",
                       isCrossRepository=False, isDraft=False, mergeStateStatus="CLEAN",
                       statusCheckRollup=[check()], updatedAt="2026-01-01T00:00:00Z", mergeCommit=None,
                       polls=[])
        # Each poll of the PR's checks applies the next entry of `polls`; the last one stays.
        # Each `gh run list` applies the next entry of `run_polls` to `runs`; the last one stays.
        # `gh pr ready` sets `ready`, the time of the PR's last ready-for-review event.
        # `run_files` maps a check's run to its workflow file, and `workflow_files` holds their text.
        self.github = dict(workflows=True, compare=None, ready=None, run_polls=[], runs=[
            dict(workflowName="Deploy", event="push", status="completed", conclusion="success", url="https://runs/1")],
            run_files={"1": CI, "2": CI}, workflow_files={CI: "on:\n  pull_request:\n    types: [opened, ready_for_review]\n"})
        gh = self.mock / "gh"
        gh.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys, time
with open(os.environ['GH_CALLS'], 'a') as log:
    log.write(json.dumps(sys.argv[1:]) + '\\n')
assert 'GH_REPO' not in os.environ
if os.environ.get('GH_FAIL'):
    sys.stderr.write('GitHub unavailable\\n')
    sys.exit(1)
MERGED_AT = '2026-06-01T00:00:00Z'
fixture = pathlib.Path(os.environ['GH_FIXTURE'])
pr = json.loads(fixture.read_text())
github = json.loads(pathlib.Path(os.environ['GH_GITHUB']).read_text())
args = sys.argv[1:]
def not_found():
    sys.stderr.write('gh: Not Found (HTTP 404)\\n')
    sys.exit(1)
if args[:2] == ['repo', 'view']:
    print(json.dumps(dict(url='https://github.com/test/repo', nameWithOwner='test/repo',
                          defaultBranchRef=dict(name='trunk'),
                          deleteBranchOnMerge=not os.environ.get('GH_KEEPS_BRANCHES'))))
elif args[:2] == ['pr', 'view']:
    if 'statusCheckRollup' in args[-1] and pr['polls']:
        pr.update(pr['polls'].pop(0) if len(pr['polls']) > 1 else pr['polls'][0])
        fixture.write_text(json.dumps(pr))
    print(json.dumps(pr))
elif args[:2] == ['pr', 'ready']:
    pr['isDraft'] = False
    fixture.write_text(json.dumps(pr))
    github['ready'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    pathlib.Path(os.environ['GH_GITHUB']).write_text(json.dumps(github))
elif args[:2] == ['pr', 'update-branch']:
    pass
elif args[:2] == ['pr', 'merge']:
    if os.environ.get('GH_MERGE_FAIL'):
        sys.exit(1)
    pr.update(state='MERGED', mergeCommit=dict(oid='f' * 40), mergedAt=MERGED_AT)
    fixture.write_text(json.dumps(pr))
elif args[:2] == ['api', 'graphql'] and any('timelineItems' in arg for arg in args):
    print(github['ready'] or '')
elif args[:2] == ['api', 'graphql']:
    suites = [dict(workflowRun=None)] + [dict(workflowRun=dict(databaseId=int(run), file=dict(path=path)))
                                         for run, path in github['run_files'].items()]
    entries = [dict(path=path, object=dict(text=text)) for path, text in github['workflow_files'].items()]
    print(json.dumps(dict(data=dict(repository=dict(commit=dict(checkSuites=dict(nodes=suites)),
                                                    workflows=dict(entries=entries))))))
elif args[0] == 'api' and '/contents/.github/workflows?ref=' in args[1]:
    if not github['workflows']:
        not_found()
elif args[0] == 'api' and '/compare/' in args[1]:
    if not github['compare']:
        not_found()
    print(github['compare'])
elif args[:2] == ['run', 'list']:
    if github['run_polls']:
        github['runs'] = github['run_polls'].pop(0) if len(github['run_polls']) > 1 else github['run_polls'][0]
        pathlib.Path(os.environ['GH_GITHUB']).write_text(json.dumps(github))
    def option(name, default):
        return args[args.index(name) + 1] if name in args else default
    # A run is filed under the merge commit and created at the merge unless it says otherwise.
    print(json.dumps([run for run in github['runs'] if option('--event', run['event']) == run['event']
                      and option('--commit', run.get('headSha', 'f' * 40)) == run.get('headSha', 'f' * 40)
                      and run.get('createdAt', MERGED_AT) >= option('--created', '>=').removeprefix('>=')]))
else:
    sys.exit(99)
''')
        gh.chmod(0o755)

    def git(self, *args, cwd=None, check=True):
        return subprocess.run(["git", *args], cwd=cwd or self.checkout, env=self.env,
                              capture_output=True, text=True, check=check)

    def land(self, *args, cwd=None):
        (self.root / "pr.json").write_text(json.dumps(self.pr))
        (self.root / "github.json").write_text(json.dumps(self.github))
        return subprocess.run([str(LAND), *args], cwd=cwd or self.checkout,
                              env=self.env, capture_output=True, text=True)

    def calls(self, *prefix):
        calls = self.root / "calls"
        lines = calls.read_text().splitlines() if calls.exists() else []
        return [call for call in map(json.loads, lines) if call[:len(prefix)] == list(prefix)]

    def lookups(self):
        return [call for call in self.calls("api", "graphql") if any("checkSuites" in arg for arg in call)]

    def merge_calls(self):
        return self.calls("pr", "merge")

    def merge_call(self, head=None):
        return ["pr", "merge", "123", "--repo", "https://github.com/test/repo", "--squash",
                "--match-head-commit", head or self.pr["headRefOid"]]

    def add_upstream(self):
        remote = self.root / "remote.git"
        self.git("init", "--bare", "-b", "trunk", str(remote))
        self.git("remote", "add", "origin", str(remote))
        self.git("push", "-u", "origin", "trunk")
        return self.git("rev-parse", "origin/trunk").stdout.strip()

    def assert_branch(self, exists=True):
        result = self.git("show-ref", "--verify", "--quiet", "refs/heads/feature/topic", check=False)
        self.assertEqual(result.returncode == 0, exists)

    def test_squash_cleanup_only_deletes_requested_branch(self):
        self.git("branch", "unrelated", "feature/topic")
        self.git("config", "branch.unrelated.remote", "origin")
        self.git("config", "branch.unrelated.merge", "refs/heads/gone")
        result = self.land("123")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_branch(False)
        self.git("show-ref", "--verify", "refs/heads/unrelated")
        self.assertEqual(self.git("branch", "--show-current").stdout.strip(), "trunk")
        result = self.land("123")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("already absent", result.stdout)
        self.assertEqual(self.merge_calls(), [])

    def test_current_branch_switches_to_non_main_base(self):
        self.git("switch", "feature/topic")
        result = self.land()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_branch(False)
        self.assertEqual(self.git("branch", "--show-current").stdout.strip(), "trunk")
        calls = [json.loads(line) for line in (self.root / "calls").read_text().splitlines()]
        self.assertEqual(calls[1][2], "feature/topic")

    def test_gone_upstream_in_other_worktree_reports_path(self):
        worktree = self.root / "linked tree\nwith newline"
        self.git("worktree", "add", str(worktree), "feature/topic")
        self.git("remote", "add", "origin", "https://github.com/test/repo")
        self.git("config", "branch.feature/topic.remote", "origin")
        self.git("config", "branch.feature/topic.merge", "refs/heads/feature/topic")
        self.assertIn("+ feature/topic", self.git("branch", "-vv").stdout)
        result = self.land("123")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(repr(str(worktree)), result.stderr)
        self.assertNotIn("branch '+' not found", result.stderr)
        self.assertTrue(worktree.exists())
        self.assert_branch()

    def test_base_in_other_worktree_detaches_linked_worktree(self):
        worktree = self.root / "topic"
        self.git("worktree", "add", str(worktree), "feature/topic")
        result = self.land(cwd=worktree)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assert_branch(False)
        self.assertEqual(self.git("branch", "--show-current", cwd=worktree).stdout.strip(), "")
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=worktree).stdout.strip(), self.pr["headRefOid"])

    def test_extra_local_commits_are_preserved(self):
        self.git("switch", "feature/topic")
        self.git("commit", "--allow-empty", "-m", "unpublished")
        result = self.land()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("tip isn't part of merged PR #123", result.stderr)
        self.assert_branch()

    def test_dirty_and_untracked_files_prevent_switch(self):
        self.git("switch", "feature/topic")
        for name in ("tracked", "untracked"):
            with self.subTest(name=name):
                target = self.checkout / name
                target.write_text("local work\n")
                result = self.land()
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("Commit or stash", result.stderr)
                self.assertEqual(target.read_text(), "local work\n")
                self.assert_branch()
                if name == "tracked":
                    self.git("restore", "tracked")
                else:
                    target.unlink()

    def test_closed_foreign_and_fork_prs_are_preserved(self):
        for overrides in (dict(state="CLOSED"),
                          dict(state="OPEN", url="https://github.com/other/repo/pull/123"),
                          dict(isCrossRepository=True)):
            with self.subTest(overrides=overrides):
                original = self.pr.copy()
                self.pr.update(overrides)
                self.assertNotEqual(self.land("123").returncode, 0)
                self.assert_branch()
                self.assertEqual(self.merge_calls(), [])
                self.pr = original

    def test_open_pr_is_merged_then_cleaned_up(self):
        self.pr["state"] = "OPEN"
        self.git("switch", "feature/topic")
        result = self.land()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.merge_calls(), [self.merge_call()])
        self.assert_branch(False)
        self.assertEqual(self.git("branch", "--show-current").stdout.strip(), "trunk")
        self.assertNotIn("Automatically delete head branches", result.stderr)
        self.assertIn("Push runs passed.", result.stdout)
        self.assertEqual(self.calls("api", "graphql"), [])

    def test_waits_for_checks_on_the_final_head_then_merges_it(self):
        # The draft is marked ready, updated with its base, and merged only once
        # the new head's checks pass and its last update is a minute old.
        self.pr.update(state="OPEN", polls=[
            dict(isDraft=True, mergeStateStatus="DRAFT"),
            dict(mergeStateStatus="BEHIND"),
            dict(headRefOid=NEW_HEAD, mergeStateStatus="BLOCKED",
                 statusCheckRollup=[check(status="IN_PROGRESS", conclusion="")]),
            dict(mergeStateStatus="CLEAN", statusCheckRollup=[check()],
                 updatedAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")),
            dict(updatedAt="2026-01-01T00:00:00Z"),
        ])
        self.github["compare"] = "ahead"
        result = self.land("123")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(self.calls("pr", "ready")), 1)
        self.assertEqual(len(self.calls("pr", "update-branch")), 1)
        self.assertEqual(self.merge_calls(), [self.merge_call(NEW_HEAD)])
        self.assertIn("Waiting for check on aaaaaaa.", result.stdout)
        self.assertIn("Waiting for checks that a recent update may start", result.stdout)
        self.assert_branch(False)

    def test_failed_checks_prevent_merge(self):
        cases = (([check("lint", conclusion="FAILURE")], ()),
                 ([check("lint", conclusion="FAILURE"), check(status="QUEUED", conclusion="")], ("--no-wait",)),
                 ([check("lint", conclusion="CANCELLED", run=2), check(run=1)], ()))
        for rollup, options in cases:
            with self.subTest(rollup=rollup, options=options):
                self.pr.update(state="OPEN", statusCheckRollup=rollup)
                result = self.land("123", *options)
                self.assertEqual(result.returncode, 1)
                self.assertIn("lint failed on", result.stderr)
                self.assertEqual(self.merge_calls(), [])
                self.assert_branch()

    def test_check_cancelled_by_a_newer_run_is_ignored(self):
        self.pr.update(state="OPEN", statusCheckRollup=[check(conclusion="CANCELLED", run=1), check(run=2)])
        result = self.land("123")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.merge_calls(), [self.merge_call()])

    def test_cancelled_check_waits_for_its_replacement(self):
        # Marking a draft ready starts a run that cancels the one in progress,
        # and the cancelled check can show before the new run's checks do.
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        self.pr.update(state="OPEN", polls=[
            dict(isDraft=True, mergeStateStatus="DRAFT", statusCheckRollup=[check(status="IN_PROGRESS", conclusion="")]),
            dict(mergeStateStatus="CLEAN", updatedAt=now, statusCheckRollup=[check(conclusion="CANCELLED")]),
            dict(statusCheckRollup=[check(conclusion="CANCELLED"), check(status="IN_PROGRESS", conclusion="", run=2)]),
            dict(updatedAt="2026-01-01T00:00:00Z", statusCheckRollup=[check(conclusion="CANCELLED"), check(run=2)]),
        ])
        result = self.land("123")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.merge_calls(), [self.merge_call()])

    def test_cancelled_check_without_a_replacement_fails_once_quiet(self):
        self.pr.update(state="OPEN", polls=[
            dict(updatedAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                 statusCheckRollup=[check(conclusion="CANCELLED")]),
            dict(updatedAt="2026-01-01T00:00:00Z"),
        ])
        result = self.land("123")
        self.assertEqual(result.returncode, 1)
        self.assertIn("Waiting for check on", result.stdout)
        self.assertIn("check failed on", result.stderr)
        self.assertEqual(self.merge_calls(), [])

    def test_check_skipped_as_a_draft_never_authorizes_a_merge(self):
        # CI that skips its job on drafts leaves a skipped check, which GitHub counts as passed.
        for options in ((), ("--no-wait",)):
            with self.subTest(options=options):
                self.pr.update(state="OPEN", isDraft=True, mergeStateStatus="DRAFT",
                               statusCheckRollup=[check(conclusion="SKIPPED")],
                               polls=[{}, dict(mergeStateStatus="CLEAN"), {}, dict(state="CLOSED")])
                result = self.land("123", *options)
                self.assertEqual(result.returncode, 1, result.stderr)
                self.assertIn("became CLOSED while land waited", result.stderr)
                self.assertEqual(self.merge_calls(), [])
        # When no run replaces the skipped check, the 45-minute wait ends with the reason.
        self.pr["polls"] = [{}, dict(mergeStateStatus="CLEAN")]
        result = self.land("123")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("check skipped while it was a draft and didn't run again", result.stderr)
        self.assertEqual(self.merge_calls(), [])

    def test_check_skipped_as_a_draft_waits_for_its_replacement(self):
        skipped = check(conclusion="SKIPPED")
        def polls(replacement):
            return [{}, dict(mergeStateStatus="CLEAN"),
                    dict(statusCheckRollup=[skipped, check(status="IN_PROGRESS", conclusion="", run=2)]),
                    dict(statusCheckRollup=[skipped, replacement])]
        self.pr.update(state="OPEN", isDraft=True, mergeStateStatus="DRAFT", statusCheckRollup=[skipped],
                       polls=polls(check(conclusion="FAILURE", run=2)))
        result = self.land("123")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertIn("check failed on", result.stderr)
        self.assertEqual(self.merge_calls(), [])
        self.assertEqual(len(self.lookups()), 1)
        self.pr["polls"] = polls(check(run=2))
        result = self.land("123")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.merge_calls(), [self.merge_call()])

    def test_check_skipped_by_a_workflow_that_ignores_the_ready_event_passes(self):
        # Like the standards auto-merge workflow, which a draft's ready event never runs again.
        self.github["run_files"]["5"] = ".github/workflows/auto-merge.yml"
        self.github["workflow_files"][".github/workflows/auto-merge.yml"] = (
            "on:\n  pull_request_target:\n    # Not ready_for_review: drafts skip.\n    types: [opened, synchronize]\n")
        auto_merge = dict(check("auto-merge", conclusion="SKIPPED", run=5), workflowName="Auto-merge")
        for options in ((), ("--no-wait",)):
            with self.subTest(options=options):
                self.pr.update(state="OPEN", isDraft=True, mergeStateStatus="DRAFT",
                               statusCheckRollup=[auto_merge, check(run=2)], polls=[{}, dict(mergeStateStatus="CLEAN")])
                result = self.land("123", *options)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.merge_calls()[-1:], [self.merge_call()])
                self.assertTrue(self.lookups())

    def test_check_skipped_without_a_draft_passes(self):
        # A PR that was never a draft has no ready event, and a check skipped after it ran its condition.
        for ready in (None, "2025-12-31T00:00:00Z"):
            with self.subTest(ready=ready):
                self.github["ready"] = ready
                self.pr.update(state="OPEN", statusCheckRollup=[check("lint", conclusion="SKIPPED"), check()])
                result = self.land("123", "--no-wait")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(self.calls("api", "graphql"))
                self.assertEqual(self.lookups(), [])

    def test_no_wait_skips_pending_checks_only_where_github_allows(self):
        self.pr.update(state="OPEN", statusCheckRollup=[check(status="IN_PROGRESS", conclusion="")],
                       mergeStateStatus="BLOCKED")
        result = self.land("123", "--no-wait")
        self.assertEqual(result.returncode, 1)
        self.assertIn("--no-wait can't skip them", result.stderr)
        self.assertEqual(self.merge_calls(), [])
        self.pr["mergeStateStatus"] = "UNSTABLE"
        result = self.land("123", "--no-wait")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.merge_calls(), [self.merge_call()])

    def test_blocked_pr_with_passed_checks_stops_waiting(self):
        self.pr.update(state="OPEN", mergeStateStatus="BLOCKED")
        result = self.land("123")
        self.assertEqual(result.returncode, 1)
        self.assertIn("although its checks passed", result.stderr)
        self.assertEqual(self.merge_calls(), [])

    def test_checks_are_awaited_unless_the_head_has_no_workflows(self):
        self.pr.update(state="OPEN", statusCheckRollup=[], polls=[{}, dict(state="CLOSED")])
        result = self.land("123")
        self.assertEqual(result.returncode, 1)
        self.assertIn("became CLOSED while land waited", result.stderr)
        self.assertEqual(self.merge_calls(), [])
        # Without workflows, a draft that changed just now merges once it is ready.
        self.pr.update(polls=[], isDraft=True,
                       updatedAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
        self.github["workflows"] = False
        result = self.land("123")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.merge_calls(), [self.merge_call()])
        self.assertEqual(self.calls("run", "list"), [])

    def test_push_runs_decide_the_exit_code_after_cleanup(self):
        self.pr["state"] = "OPEN"
        for runs, code, message in (
                ([dict(workflowName="Deploy", event="push", status="completed", conclusion="failure",
                       url="https://runs/2")],
                 2, "Push run Deploy failure: https://runs/2"),
                ([], 0, "No push runs.")):
            with self.subTest(runs=runs):
                self.github["runs"] = runs
                result = self.land("123")
                self.assertEqual(result.returncode, code, result.stderr)
                self.assertIn(message, result.stdout + result.stderr)
                self.assert_branch(False)

    def test_push_runs_include_chained_runs_that_appear_later(self):
        # A deploy chained with `on: workflow_run` starts only after the push run it follows has passed.
        # GitHub files it under the default branch's newest commit, here a later merge's.
        self.pr["state"] = "OPEN"
        build = dict(workflowName="Build", event="push", status="completed", conclusion="success", url="https://runs/3")
        deploy = dict(workflowName="Deploy", event="workflow_run", status="in_progress", conclusion="",
                      url="https://runs/4", headSha="b" * 40, createdAt="2026-06-01T00:05:00Z")
        nightly = dict(workflowName="Nightly", event="schedule", status="completed", conclusion="failure",
                       url="https://runs/5")
        earlier = dict(workflowName="Deploy", event="workflow_run", status="completed", conclusion="failure",
                       url="https://runs/6", createdAt="2026-05-31T23:59:59Z")
        others = [nightly, earlier]
        self.github["run_polls"] = [[build, *others], [build, *others], [deploy, build, *others],
                                    [dict(deploy, status="completed", conclusion="failure"), build, *others]]
        result = self.land("123")
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn("Push run Deploy failure: https://runs/4", result.stderr)
        self.assertNotIn("Push runs passed.", result.stdout)
        self.assertNotIn("Nightly", result.stderr)
        self.assertNotIn("runs/6", result.stderr)

    def test_unknown_options_are_refused_before_github_is_called(self):
        self.pr["state"] = "OPEN"
        result = self.land("123", "--auto")
        self.assertEqual(result.returncode, 1)
        self.assertIn("unexpected arguments: 123 --auto", result.stderr)
        self.assertEqual(self.calls(), [])

    def test_failed_merge_preserves_branch(self):
        self.pr["state"] = "OPEN"
        self.env["GH_MERGE_FAIL"] = "1"
        result = self.land("123")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("was not merged", result.stderr)
        self.assert_branch()

    def test_cleanup_failure_after_merge_only_warns(self):
        self.pr["state"] = "OPEN"
        self.git("switch", "feature/topic")
        self.git("commit", "--allow-empty", "-m", "unpublished")
        result = self.land()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("PR #123 is merged, but local cleanup stopped", result.stderr)
        self.assertIn("tip isn't part of merged PR #123", result.stderr)
        self.assert_branch()

    def test_merge_warns_when_github_keeps_merged_branches(self):
        self.pr["state"] = "OPEN"
        self.env["GH_KEEPS_BRANCHES"] = "1"
        result = self.land("123")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Automatically delete head branches", result.stderr)

    def test_base_fast_forwards_from_upstream(self):
        merged = self.add_upstream()
        self.git("reset", "--hard", "HEAD~1")
        self.git("switch", "feature/topic")
        result = self.land()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.git("branch", "--show-current").stdout.strip(), "trunk")
        self.assertEqual(self.git("rev-parse", "trunk").stdout.strip(), merged)
        self.assert_branch(False)

    def test_diverged_base_is_not_merged(self):
        merged = self.add_upstream()
        self.git("reset", "--hard", "HEAD~1")
        self.git("commit", "--allow-empty", "-m", "local base work")
        local = self.git("rev-parse", "trunk").stdout.strip()
        result = self.land("123")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Could not fast-forward 'trunk'", result.stderr)
        self.assertEqual(self.git("rev-parse", "trunk").stdout.strip(), local)
        self.assertNotEqual(local, merged)
        self.assert_branch(False)

    def test_default_and_base_branches_are_protected(self):
        for overrides in (dict(headRefName="trunk"), dict(baseRefName="feature/topic")):
            with self.subTest(overrides=overrides):
                original = self.pr.copy()
                self.pr.update(overrides)
                result = self.land("123")
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("base or default branch", result.stderr)
                self.assert_branch()
                self.pr = original

    def test_missing_base_leaves_current_branch_intact(self):
        self.git("switch", "feature/topic")
        self.pr["baseRefName"] = "missing"
        result = self.land()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("is not local", result.stderr)
        self.assert_branch()

    def test_detached_head_requires_selector(self):
        self.git("switch", "--detach")
        result = self.land()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Detached HEAD", result.stderr)
        result = self.land("123")
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_api_failure_preserves_branch(self):
        self.env["GH_FAIL"] = "1"
        result = self.land("123")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("GitHub unavailable", result.stderr)
        self.assert_branch()

    def test_checkout_hook_moving_branch_prevents_deletion(self):
        self.git("switch", "feature/topic")
        hook = self.checkout / ".git/hooks/post-checkout"
        hook.write_text('#!/bin/sh\ngit update-ref refs/heads/feature/topic refs/heads/trunk\n')
        hook.chmod(0o755)
        result = self.land()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("tip changed during cleanup", result.stderr)
        self.assert_branch()

    def test_checkout_repository_takes_precedence_over_gh_repo(self):
        self.env["GH_REPO"] = "other/repo"
        result = self.land("https://github.com/test/repo/pull/123")
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
