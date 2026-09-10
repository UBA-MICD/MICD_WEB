Feature: [TK-29] Admin-only server configuration from the server page
  As the MICD team
  I want server re-configuration to be an admin-only action inside the server page
  So that the Servidor button routes to the server interface and no user can
  re-point the server from the main page and break their session.

  # Manual / BDD test guide. Run in the browser build (nginx or `npm run build` +
  # open the page). The "settings/gear control" is the server-screen header button
  # `#btn-server-settings`; the configuration modal is `#server-config-dialog`.

  Background:
    Given the web client is loaded
    And the app has started on the viewer (main) screen

  # ── The Servidor button routes to the server interface ──────────────────────

  Scenario: The Servidor button opens the server interface, not the config modal
    Given I am on the main page
    When I click the "Servidor" button
    Then the server screen opens on the "Buscar" tab
    And the server-configuration modal does not appear

  Scenario Outline: Every role reaches the server interface the same way
    Given I am signed in as "<role>"
    When I click the "Servidor" button
    Then the server screen opens on the "Buscar" tab

    Examples:
      | role         |
      | admin        |
      | medico       |
      | investigador |

  # ── The settings control is admin-only ──────────────────────────────────────

  Scenario: An admin sees the settings control on the server page
    Given I am signed in as "admin"
    When I open the server screen
    Then a settings (gear) control is visible in the server header

  Scenario Outline: Non-admins never see the settings control
    Given I am signed in as "<role>"
    When I open the server screen
    Then no settings control is present in the server header

    Examples:
      | role         |
      | medico       |
      | investigador |

  Scenario: A guest does not see the settings control
    Given I have not signed in
    When I open the server screen
    Then I land on the server auth card
    And no settings control is present in the server header

  Scenario: The settings control follows a live role change
    Given I am signed in as "admin" with the server screen open
    And the settings control is visible
    When my role changes to "medico" and the screen re-renders
    Then the settings control is no longer visible

  # ── The settings control opens the existing modal ───────────────────────────

  Scenario: Activating the settings control opens the configuration modal
    Given I am signed in as "admin" on the server screen
    When I activate the settings control
    Then the server-configuration modal opens
    And it is pre-filled with the active server URL

  Scenario: The configuration modal keeps its existing behaviour
    Given the admin has opened the configuration modal
    When I submit a valid server URL
    Then the URL is validated, persisted, and the studies list reloads
    When I submit an invalid URL instead
    Then the modal stays open and shows the validation error
    When I press Cancel
    Then the modal closes and the active server URL is unchanged

  # ── No main-page path to change the server ──────────────────────────────────

  Scenario: The main page offers no way to change the server
    Given I am on the main (viewer) page in any role
    Then there is no control on the main page that changes the server configuration

  # ── i18n ────────────────────────────────────────────────────────────────────

  Scenario Outline: The settings control's accessible name is localized
    Given I am signed in as "admin" on the server screen
    When the language is "<lang>"
    Then the settings control's accessible name reads "<label>"

    Examples:
      | lang | label              |
      | es   | Configurar servidor |
      | en   | Configure server   |
