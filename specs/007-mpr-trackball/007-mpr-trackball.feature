Feature: [TK-30] Rotación oblicua del MPR con control trackball (Pitch/Yaw)
  Como médico radiólogo
  Quiero un control dedicado (trackball) en la barra de herramientas MPR
  Para rotar los planos con precisión (Pitch/Yaw), separando la acción de rotar
  de la acción de trasladar el crosshair en la imagen.

  # Manual / BDD test guide. Ejecutar en el build de navegador y repetir en la app
  # de escritorio tras `make sync-web`. El trackball es `.mpr-trackball`; sus partes
  # son la esfera (`.mpr-trackball-sphere`), los sliders `.mpr-trackball-pitch` /
  # `.mpr-trackball-yaw`, el readout y el botón Reset (`.mpr-trackball-reset`).
  # Convención de signos: arrastre a la derecha => Yaw positivo; arrastre hacia
  # abajo => Pitch positivo.

  Background:
    Given el cliente web está cargado
    And hay un estudio volumétrico abierto en modo MPR con la grilla 2x2
    And los planos están en los ejes anatómicos ortogonales (Axial, Coronal, Sagital)

  # ── Rotación por arrastre sobre la esfera ───────────────────────────────────

  Scenario: Arrastre horizontal controla el Yaw
    Given el trackball está visible en la barra de herramientas MPR
    When arrastro la esfera horizontalmente hacia la derecha
    Then la rotación del triedro gira sobre el eje vertical del plano activo
    And el readout muestra un Yaw positivo y el Pitch sin cambios
    And los tres planos 2D se renderizan sincronizados con la rotación

  Scenario: Arrastre vertical controla el Pitch
    Given el trackball está visible en la barra de herramientas MPR
    When arrastro la esfera verticalmente hacia abajo
    Then la rotación del triedro gira sobre el eje horizontal del plano activo
    And el readout muestra un Pitch positivo y el Yaw sin cambios

  Scenario: Shift activa el ajuste fino
    Given el trackball está visible en la barra de herramientas MPR
    When arrastro 10 píxeles con la tecla Shift presionada
    Then el ángulo aplicado es la décima parte del aplicado sin Shift

  Scenario: Un solo evento nunca produce un salto brusco
    When un único evento de puntero tiene un desplazamiento muy grande
    Then el ángulo aplicado en ese evento no supera 15 grados

  # ── Lectura del ángulo ──────────────────────────────────────────────────────

  Scenario Outline: El readout refleja la rotación acumulada en el idioma activo
    Given roté los planos hasta Pitch 12 grados y Yaw -30 grados
    When el idioma es "<lang>"
    Then el readout muestra "<texto>"

    Examples:
      | lang | texto                 |
      | es   | Pitch 12,0° · Yaw -30,0° |
      | en   | Pitch 12.0° · Yaw -30.0° |

  # ── Reset a ejes anatómicos ─────────────────────────────────────────────────

  Scenario: Reset restaura los planos ortogonales sin mover el crosshair
    Given roté los planos hasta Pitch 45 grados y Yaw 30 grados
    And el crosshair está en un punto anatómico P
    When activo el botón Reset del trackball
    Then las normales vuelven a (0,0,1) Axial, (0,1,0) Coronal y (1,0,0) Sagital
    And el readout muestra Pitch 0,0° · Yaw 0,0°
    And el crosshair sigue en el punto P, y el zoom y el pan no cambian
    And un lector de pantalla anuncia una sola vez "Planos restablecidos a ortogonales"

  # ── Desacople del crosshair ─────────────────────────────────────────────────

  Scenario: Arrastrar un brazo del crosshair sólo traslada el crosshair
    Given la herramienta "crosshair" está activa
    When arrastro con el botón izquierdo sobre un brazo del crosshair en un plano 2D
    Then el centro del crosshair se traslada siguiendo el puntero
    And la rotación de los planos no cambia

  Scenario: Arrastrar el trackball no mueve el crosshair
    When arrastro la esfera del trackball
    Then la posición del crosshair no cambia
    And la herramienta activa sigue siendo la misma

  Scenario: El trackball no aparece en la vista 3D combinada
    When el viewport activo es la vista 3D combinada
    Then el trackball no se muestra

  Scenario: Un segundo dedo no inicia otro arrastre
    Given un puntero primario está arrastrando la esfera
    When un segundo puntero toca la esfera
    Then ese segundo puntero se ignora

  # ── Teclado y lector de pantalla ────────────────────────────────────────────

  Scenario: El trackball es un único tab stop
    When navego con Tab hacia la barra MPR
    Then el grupo del trackball recibe el foco una sola vez
    And las flechas me mueven entre Pitch, Yaw y Reset

  Scenario Outline: Los sliders se operan con el teclado
    Given el foco está en el slider "<slider>" con valor 0
    When presiono "<tecla>"
    Then el valor pasa a <valor> grados

    Examples:
      | slider | tecla             | valor |
      | Yaw    | Flecha derecha    | 1     |
      | Yaw    | Shift + Flecha der| 10    |
      | Pitch  | Flecha arriba     | 1     |
      | Pitch  | AvPág             | -15   |
      | Pitch  | RePág             | 15    |

  Scenario: Los sliders comunican su valor sin anuncios por cada movimiento
    When muevo un slider con el teclado
    Then el valor se expone por aria-valuetext localizado
    And no se emiten anuncios aria-live por cada cambio

  # ── Accesibilidad visual ────────────────────────────────────────────────────

  Scenario: Contraste y foco visibles en ambos temas
    When observo el trackball en el tema claro y en el oscuro
    Then el contorno de la esfera, los thumbs y el anillo de foco tienen contraste no textual de al menos 3:1

  Scenario: Con movimiento reducido el reset es instantáneo
    Given el sistema pide movimiento reducido
    When activo el botón Reset
    Then no hay transición animada
