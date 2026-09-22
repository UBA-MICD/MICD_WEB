Feature: Study pathology classification (web)
  The upload page fetches the category catalog from the server, the user tags a
  study by picking a category, and studies show their category as a badge.

  Background:
    Given I am on the server screen authenticated as a "medico"

  Scenario: The selector is populated from the server catalog
    When I open the Cargar tab
    Then the classification selector lists the 6 categories with translated labels
    And it has a blank "Sin clasificar" default

  Scenario: Upload with a chosen category
    Given I am on the Cargar tab
    And I select "Tumor" in the classification selector
    When I upload a valid DICOM
    Then the study appears in Buscar with a "Tumor" badge

  Scenario: Category is optional
    Given I am on the Cargar tab with no category selected
    When I upload a valid DICOM
    Then the study appears with a "Sin clasificar" badge

  Scenario: Labels follow the locale
    Given a study classified as "Tumor" is shown and the Cargar tab is open
    When I switch the language to English
    Then the selector options and the study badge read the English terms

  Scenario: Quick-drop has no selector
    Given I am on the Buscar/explorer view
    Then no classification selector is shown
    When I drop a valid DICOM there
    Then the study is uploaded unclassified
