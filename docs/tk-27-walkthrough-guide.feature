Feature: [TK-27] Tutorial tipo "follow along" en la aplicación (web)
  As a MICD user of any role (admin / medico / investigador)
  I want an in-app tour that spotlights real UI elements as I use them
  So that I can learn the features my role can actually use, on first login
  and again on demand.

  # Manual test guide. Run in the browser build (nginx or `npm run build` +
  # open the page). "Seen flag" = localStorage key micd.tour.seen.<role>.
  # To retest first-login behaviour, clear that key (DevTools > Application >
  # Local Storage) or use a private window.

  Background:
    Given the web client is loaded in a supported browser
    And no walkthrough seen-flag exists for the role under test

  # ── Acceptance criterion: activates on first login ──────────────────────────

  Scenario Outline: The tour auto-starts once on a role's first login
    Given I have never seen the tour as "<role>"
    When I sign in as a "<role>" user for the first time
    Then the walkthrough starts automatically
    And a dimmed overlay spotlights the first relevant element
    And the popover shows "Step 1 of N" for the "<role>" script

    Examples:
      | role         |
      | admin        |
      | medico       |
      | investigador |

  Scenario: The tour does not auto-start on a later login
    Given I have already seen (completed or skipped) the tour as my role
    When I sign in again with that role
    Then the walkthrough does not start automatically
    And I can still relaunch it from the Help button

  Scenario: A guest is not auto-toured but can launch the core tour
    Given I have not signed in
    When the app finishes loading
    Then the walkthrough does not start automatically
    And clicking the Help button starts the common viewer-core tour

  # ── Acceptance criterion: manually relaunchable ─────────────────────────────

  Scenario Outline: The Help button relaunches the tour from any screen
    Given I am signed in as "<role>"
    And I am currently on the "<screen>" screen
    When I click the top-bar Help (?) button
    Then the walkthrough starts from step 1 of my role's script
    And it navigates me back to the correct screen for each step

    Examples:
      | role         | screen |
      | admin        | viewer |
      | admin        | server |
      | medico       | viewer |
      | investigador | server |

  # ── Acceptance criterion: highlights / focuses elements each step ───────────

  Scenario: Each step spotlights the element it describes
    Given the walkthrough is running
    When I advance from one step to the next
    Then only the current target element is cut out of the dimmer
    And an outline ring is drawn around that element
    And the popover is anchored next to it and describes it

  Scenario: Follow-along steps advance when I perform the real action
    Given the walkthrough is on a follow-along step for the window/level tool
    When I actually activate the window/level tool
    Then the tour advances to the next step without my clicking Next

  Scenario: A follow-along step still offers a Next fallback
    Given the walkthrough is on a follow-along step I cannot complete
      (for example, upload a study when I have no files)
    When I click Next in the popover
    Then the tour advances to the next step anyway

  Scenario: The tour drives cross-screen navigation itself
    Given I am on the viewer screen with the tour running
    When the tour reaches a step whose feature lives on the server screen
    Then the tour opens the server screen (and the correct tab) before spotlighting
    And it returns to the viewer for any following viewer-only step

  # ── Acceptance criterion: skip / close at any time ──────────────────────────

  Scenario Outline: The tour can be dismissed at any step
    Given the walkthrough is running on any step
    When I dismiss it via "<method>"
    Then the overlay and popover disappear
    And focus returns to the control that opened the tour
    And the seen-flag for my role is set so it will not auto-start again

    Examples:
      | method            |
      | the X close button |
      | the Skip button   |
      | the Escape key    |

  Scenario: Dismissing is one-shot, with no "don't show again" checkbox
    Given the walkthrough is running
    Then there is no "don't show again" checkbox
    And skipping or finishing alone prevents future auto-starts
    And the exit copy tells me I can reopen it from the Help button

  # ── Acceptance criterion: role branching (guide over all features by role) ──

  Scenario: An investigador sees only read-only, PHI-free steps
    Given I am signed in as "investigador"
    When I run the full walkthrough
    Then I am guided through search, date filters, opening a study, and export
    And the results/export steps state that identity is anonymized for my role
    And I am shown Zenodo public-corpus search only
    And I am NOT shown the upload tab, the users tab, activity log,
      or Zenodo config/publish/logs

  Scenario: A medico sees viewing plus upload, with full PHI, but no admin tools
    Given I am signed in as "medico"
    When I run the full walkthrough
    Then I am guided through the upload tab (drag-drop and folder upload)
    And study data is shown with full PHI (no "anonymized" framing)
    And I am NOT shown the users tab, activity log, or Zenodo config/publish

  Scenario: An admin sees every feature including the admin-only surfaces
    Given I am signed in as "admin"
    When I run the full walkthrough
    Then I am guided through the users panel (create, role change, block, soft-delete, last-access)
    And through the activity/audit log and its export
    And through Zenodo config, publish, and sync-logs
    And every viewer and staff feature as well

  Scenario: A step whose target is hidden for my role is skipped cleanly
    Given a step targets an element my role cannot see
    When the tour reaches that step
    Then it is skipped silently without an empty spotlight or a broken popover

  Scenario: Promotion to a new role offers that role's tour next login
    Given I have seen the tour as "medico"
    And an admin promotes me to "admin"
    When I next sign in and the admin role is detected
    Then the admin walkthrough is offered because I have not seen it as admin

  # ── i18n ────────────────────────────────────────────────────────────────────

  Scenario Outline: All tour copy is localized and switches live
    Given the walkthrough is running in "<from>"
    When I change the language selector to "<to>"
    Then the popover title, body, and controls re-render in "<to>"
    And no raw i18n keys are visible

    Examples:
      | from | to |
      | es   | en |
      | en   | es |

  # ── Accessibility ───────────────────────────────────────────────────────────

  Scenario: The tour is keyboard and screen-reader operable
    Given the walkthrough is running
    Then the popover is a focus-trapped dialog labelled by its title
    And step progress ("Step N of M") is announced via a live region
    And Tab stays within the popover, Enter triggers Next, and Escape closes it
    And a Skip-step escape hatch is always present

  Scenario: Reduced motion is respected
    Given my system prefers reduced motion
    When the walkthrough moves between steps
    Then the spotlight and popover reposition instantly with no animation
