Feature: Study pathology classification (web)
  The upload page fetches the category catalog from the server, the user tags a
  study by picking a category, and studies show their category as a badge.

  Background:
    Given I am on the server screen authenticated as a "medico"

  Scenario: The selector is populated from the server catalog
    When I open the Cargar tab and add a valid DICOM
    Then the classify dialog lists the 6 categories with translated labels
    And it has a blank "Sin clasificar" default

  Scenario: Files first, then classification, then upload
    Given I am on the Cargar tab
    When I pick a valid DICOM
    Then the classify dialog opens reset to "Sin clasificar"
    And nothing has been uploaded yet
    When I select "Tumor" and press "Subir"
    Then the study appears in Buscar with a "Tumor" badge

  Scenario: Category is optional
    Given I am on the Cargar tab
    When I drop a valid DICOM and press "Subir" without choosing a category
    Then the study appears with a "Sin clasificar" badge

  Scenario: Cancelling the dialog uploads nothing
    Given I am on the Cargar tab
    When I drop a valid DICOM and press "Cancelar"
    Then the dialog closes and no file is uploaded

  Scenario: No browser folder prompt
    Given I am on the Cargar tab in a browser
    Then there is no "Seleccionar carpeta" button
    When I drop a folder containing sub-folders of DICOM files
    Then every DICOM inside is queued and no browser prompt appears
    And the classify dialog opens

  Scenario: Desktop keeps the folder button
    Given I am on the Cargar tab in the desktop app
    Then the "Seleccionar carpeta" button is shown

  Scenario: Labels follow the locale
    Given a study classified as "Tumor" is shown
    When I switch the language to English
    Then the study badge reads the English term
    When I add a valid DICOM on the Cargar tab
    Then the classify dialog's options read the English terms

  Scenario: Quick-drop has no selector
    Given I am on the Buscar/explorer view
    Then no classification selector is shown
    When I drop a valid DICOM there
    Then the study is uploaded unclassified
