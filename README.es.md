# AC Room Card

[![HACS Custom](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
![version](https://img.shields.io/badge/version-0.35.1-blue.svg)
![license](https://img.shields.io/badge/license-MIT-green.svg)

> 🇬🇧 [Read this in English](README.md)

Una tarjeta de Lovelace que **envuelve la tarjeta de clima que ya usas** y le
agrega la línea que siempre le falta: consumo en vivo, estado de la ventana,
temperatura de la pieza, ventiladores de la pieza y un **temporizador de
apagado** integrado.

<img src="docs/room-card.png" alt="AC Room Card" width="420">

Tu tarjeta de clima, intacta, con una línea de datos en vivo debajo y el
temporizador de apagado más abajo. Acá la pieza está apagada, la ventana está
cerrada (verde), el sensor de la pieza marca 17,6 °C y el ventilador de techo
está detenido (azul).

<img src="docs/room-card-fans.png" alt="Una pieza con tres ventiladores" width="420">

Una pieza con tres ventiladores, todos en la misma línea.

## Por qué

La mayoría de las tarjetas de clima muestran la temperatura y el modo, y nada
más. Pero lo que de verdad quieres saber de un aire es *si está consumiendo
ahora*, *si hay una ventana abierta mientras funciona* y *cuándo se va a
apagar*. Esta tarjeta agrega justo eso, sin reemplazar la tarjeta que ya te
gusta.

No reimplementa un termostato. Crea **cualquier** otra tarjeta en tiempo de
ejecución con `loadCardHelpers()` y dibuja alrededor, así que conservas su
comportamiento, sus traducciones y sus actualizaciones.

**Sin dependencias y sin compilar.** Un solo archivo `.js`.

---

## Dos tarjetas en un archivo

| Tarjeta | Qué es |
|---|---|
| `custom:ac-room-card` | Una pieza, con todo el detalle. Envuelve tu tarjeta de clima. |
| `custom:ac-rooms-card` | Varias piezas, una línea compacta cada una. Pensada para el celular. Ver [AC Rooms Card](#ac-rooms-card). |

Las dos vienen en el mismo `.js`: una sola instalación te da ambas.

---

## Instalación

### HACS (repositorio personalizado)

1. HACS → menú de tres puntos → **Repositorios personalizados**
2. URL: `https://github.com/tsmithf2020/ac-room-card`, categoría **Dashboard**
3. Instala y recarga el navegador sin caché (Ctrl+Shift+R)

### Manual

1. Copia `ac-room-card.js` a `/config/www/ac-room-card/`
2. Ajustes → Paneles de control → menú de tres puntos → **Recursos** → Agregar
   `/local/ac-room-card/ac-room-card.js` como **Módulo JavaScript**
3. Recarga el navegador sin caché

> Si instalas por HACS **y** a mano, la tarjeta se carga dos veces desde dos URL
> distintas. No se cae (el segundo registro se ignora), pero gana la que cargue
> primero y las actualizaciones parecen no aplicarse. Deja solo una.

---

## Inicio rápido

La tarjeta se configura entera **desde la interfaz**. Agrégala, elige tu entidad
de clima y completa los sensores que tengas. Todo es opcional salvo `entity`, y
lo que no pones se oculta solo.

El editor deja a la vista el equipo, la vista de arriba y el nombre, y pliega lo
demás en secciones: **Sensores**, **Ventanas**, **Enchufe**, **Ventiladores**,
**Aire IR** y **Temporizador**. Una sección que ya tiene algo configurado se abre
sola, y **Aire IR** parte con una explicación corta de cómo funcionan los modos y
las escenas.

Mínima:

```yaml
type: custom:ac-room-card
entity: climate.bedroom
```

En realidad nada es obligatorio por sí solo. Una pieza sin aire también
funciona: deja fuera `entity` y no se dibuja ninguna tarjeta arriba. Queda solo
la línea de datos y lo demás que configures:

```yaml
type: custom:ac-room-card
name: Garaje
window_entity: [binary_sensor.garage_door]
fans: [fan.garage]
```

Cada elemento de la línea aparece solo si le das su entidad: sin sensor de
potencia, no hay rayo.

Completa:

```yaml
type: custom:ac-room-card
name: Dormitorio
entity: climate.bedroom
power_entity: sensor.bedroom_ac_power
temp_entity: sensor.bedroom_temperature
window_entity: binary_sensor.bedroom_window
fans: [fan.bedroom_ceiling]
timer:
  entity: timer.bedroom_ac
  minutes_entity: input_number.bedroom_ac_minutes
  button_entity: input_button.bedroom_ac_timer
```

---

## Opciones

| Opción | Tipo | Req. | Descripción |
|---|---|:--:|---|
| `entity` | string | no | `climate.*`. También acepta `input_boolean.*` / `switch.*` para aires por IR: ver [Selector de modo](#selector-de-modo-frío--calor). **Si no la pones, no se dibuja tarjeta arriba**: sirve para una pieza con sensores pero sin aire. |
| `name` | string | no | Título sobre todo lo demás. Si lo pones, **no** se le pasa a la tarjeta envuelta, para que no lo veas dos veces. |
| `icon` | string | no | Ícono al lado del título. Sin ícono por defecto. |
| `power_entity` | string | no | Sensor de potencia (W). |
| `temp_entity` | string | no | Sensor de temperatura de la pieza. |
| `lux_entity` | string | no | Sensor de luz de la pieza. El ícono sigue al nivel: luna bajo 10 lx, sol sobre 1000. |
| `decimals` | number | no | Decimales de la temperatura de la pieza, de `0` a `3`. Con `1`, `24` se ve `24.0`. Si no lo pones, se usa el formato del sensor. |
| `power_switch` | string \| map | no | El enchufe o relé que alimenta al aire, con su propio ícono en la línea de datos. Ver [Cortar la corriente](#cortar-la-corriente). |
| `window_entity` | string \| lista | no | Uno o más sensores de ventana: ver [Ventanas](#ventanas). |
| `battery_warn` | number | no | Umbral de pila baja en %, por defecto `20`. |
| `fans` | lista | no | Ventiladores de la pieza: ver [Ventiladores](#ventiladores). |
| `fans_position` | string | no | `inline` (por defecto), `auto` o `row`. |
| `fan_mode` | bool | no | Muestra la velocidad del ventilador **del propio aire** (`fan_modes` de la entidad `climate`). |
| `fan_mode_names` | map | no | Renombra esas velocidades, por ejemplo `auto: Automático`. |
| `energy_today_entity` | string | no | Energía usada hoy. |
| `energy_month_entity` | string | no | Energía usada este mes. |
| `timer` | map | no | Temporizador de apagado integrado: ver [Temporizador](#temporizador). |
| `modes` | lista | no | Selector frío/calor para aires sin entidad `climate`. Cada modo es un `input_boolean`, `switch`, `scene`, `script`, `button` o `input_button`, o varias escenas en `steps` para las flechas de temperatura. Ver [Selector de modo](#selector-de-modo-frío--calor). |
| `off_entity` | string | no | La escena, script o botón que dispara el botón **Apagado**, para aires cuyos modos son escenas. Ver [Selector de modo](#selector-de-modo-frío--calor). |
| `mode_buttons` | bool | no | Fila de botones de modo bajo el termostato integrado. Activa por defecto; `false` la oculta. Ver [Botones de modo](#botones-de-modo). |
| `base_view` | string | no | Lo que va arriba, elegible en el editor visual: `compact` (mini-climate con rótulos Target / Actual), `thermostat` (por defecto) o `none`. Ver [Vista compacta](#vista-compacta). |
| `base_card` | map \| `false` | no | Config completa de la tarjeta que se envuelve. Gana sobre `base_view`. Por defecto es el `thermostat` integrado; `false` no dibuja nada arriba. |
| `base_card_style` | string \| map | no | CSS que se inyecta **dentro** del shadow DOM de la tarjeta envuelta. |
| `show_warning` | bool | no | Aviso de texto cuando hay una ventana abierta con el aire andando. Apagado por defecto: el ícono rojo ya lo dice. |
| `features` | lista | no | Se pasa al `thermostat` integrado, en lugar de los botones de modo. Se ignora si pones `base_card`. |
| `labels` | map | no | Reemplaza cualquier texto de la tarjeta. |

---

## Cortar la corriente

```yaml
power_switch: switch.bedroom_ac_plug
```

El enchufe que alimenta al aire tiene su propio ícono en la línea de datos:
verde mientras hay corriente, rojo cuando está cortada. **Cortar pide dos
toques**: el primero arma el ícono, que parpadea en naranjo durante cinco
segundos, y el segundo corta. Reponer la corriente nunca pregunta. Cortarle la
corriente a un aire andando no es lo mismo que apagar una luz, y el ícono queda
al lado de los ventiladores.

```yaml
power_switch:
  entity: switch.bedroom_ac_plug
  name: Enchufe aire   # se ve en el tooltip
  icon: mdi:power-plug
  icon_off: mdi:power-plug-off
  confirm: false       # corta al primer toque
```

Sirve cualquier entidad que se pueda prender y apagar (`switch`, `light`,
`input_boolean`), y la tarjeta llama `turn_on`/`turn_off` de su propio dominio.

**En la tarjeta de piezas**, agrega `plug` a sus `columns` y el ícono aparece
justo después de los watts. Ver
[Cortar la corriente desde la lista](#cortar-la-corriente-desde-la-lista).

---

## Ventanas

```yaml
window_entity: binary_sensor.bedroom_window          # una

window_entity:                                        # o varias
  - binary_sensor.bedroom_north
  - binary_sensor.bedroom_south
```

| Estado | Color |
|---|---|
| Todas cerradas | 🟢 verde |
| **Algunas** abiertas | 🟠 naranjo |
| Todas abiertas | 🔴 rojo |
| Sin dato | ⚪ gris |

Con una sola ventana el naranjo no puede ocurrir, así que siempre significa
"abierta en parte". El tooltip lista cada ventana con su estado y, si hay más de
una, el conteo `abiertas/total`. Al tocar el ícono se abre el diálogo de más
información de la primera ventana abierta.

### Pila baja

Los sensores de puertas y ventanas andan a pila, y uno muerto es una **falla
silenciosa**: deja de reportar y la ventana se ve cerrada para siempre. Dale a
cada ventana su sensor de batería y la tarjeta pone un punto rojo en el ícono
cuando alguna baja de `battery_warn`:

```yaml
window_entity:
  - entity: binary_sensor.bedroom_north
    battery: sensor.bedroom_north_battery
  - entity: binary_sensor.bedroom_south
    battery: sensor.bedroom_south_battery
battery_warn: 20
```

El tooltip del punto dice qué sensor es y qué porcentaje tiene.

---

## Ventiladores

```yaml
fans:
  - fan.bedroom_ceiling           # basta el entity_id
  - entity: switch.bedroom_floor  # o un objeto, para nombre e ícono propios
    name: Ventilador de pie
    icon: mdi:fan
  - entity: input_boolean.summer_mode   # sirve cualquier entidad que se prenda y apague
    name: Modo verano
    icon: mdi:white-balance-sunny
    color: var(--warning-color)         # su propio color cuando está prendido
    position: start                     # antes de la potencia
```

Todos van **en la línea de datos**, junto a la potencia y la temperatura. Caben
tres sin problema. `fans_position` lo cambia: `auto` deja uno en la línea y a dos
o más les da su propia fila bajo el temporizador, y `row` usa siempre una fila
aparte. El botón es el mismo en ambos casos: solo el ícono, sin marco. El nombre
va en el tooltip.

Tócalo para prenderlo o apagarlo. **Verde prendido** (con el ícono girando),
**azul apagado**. También puedes darle a una entrada su propio `color` para
cuando está prendida: cualquier color CSS o variable del tema.

La lista no se limita a ventiladores: el cambio usa `homeassistant.toggle`, así
que cabe cualquier entidad que se prenda y apague. Un ayudante de modo verano,
una estufa, lo que tenga sentido en esa línea.

Por defecto las entradas quedan después de la temperatura. `position: start`
pone una **antes de la potencia**, que se lee mejor para algo que es un modo y no
un aparato. Acepta entidades `fan`, `switch` y `light` (algunos ventiladores
quedan expuestos en el dominio `light`), porque el cambio usa
`homeassistant.toggle`.

> Estos son los ventiladores **de la pieza**. Para la velocidad del ventilador
> del propio aire, ve `fan_mode` más abajo.

---

## Velocidad del ventilador del aire

```yaml
fan_mode: true
fan_mode_names:
  auto: Automático
  silent: Silencioso
```

Un desplegable con las velocidades que declara la entidad `climate` (`silent`,
`low`, `medium`, `high`, `auto`...), con la actual marcada. Elegir una llama
`climate.set_fan_mode`. Si el aire no declara `fan_modes`, no se dibuja nada.

---

## Temporizador

> **Esto no funciona solo.** Home Assistant no trae un temporizador de apagado
> para las entidades de clima: necesitas tres ayudantes y una automatización. La
> tarjeta dibuja y maneja la cuenta regresiva, **pero es la automatización la que
> apaga el aire.** Abajo está todo lo que necesitas.

### 1. Crea los ayudantes

En `configuration.yaml` (o en Ajustes → Dispositivos y servicios → Ayudantes).
Cambia `bedroom` por tu pieza:

```yaml
input_number:
  bedroom_ac_minutes:
    name: Minutos aire dormitorio
    icon: mdi:hvac
    min: 0
    max: 480
    step: 30
    unit_of_measurement: min
    mode: slider

input_button:
  bedroom_ac_timer:
    name: Temporizador aire dormitorio
    icon: mdi:home-thermometer

timer:
  bedroom_ac:
    name: Temporizador aire dormitorio
    duration: "00:00:00"
    restore: false
```

Se aplican sin reiniciar: Herramientas para desarrolladores → Acciones →
`input_number.reload`, `input_button.reload` y `timer.reload`.

### 2. Crea la automatización

```yaml
alias: Aire - apagado con temporizador DORMITORIO
mode: restart
triggers:
  - trigger: state
    entity_id: input_button.bedroom_ac_timer
    id: start
  - trigger: event
    event_type: timer.finished
    event_data:
      entity_id: timer.bedroom_ac
    id: finished
  - trigger: state
    entity_id: climate.bedroom
    to: "off"
    not_from: [unavailable, unknown]
    id: manual_off
conditions: []
actions:
  - choose:
      # Arrancar, solo si el aire está andando y hay minutos puestos
      - conditions:
          - condition: trigger
            id: start
          - condition: numeric_state
            entity_id: input_number.bedroom_ac_minutes
            above: 0
          - condition: template
            value_template: "{{ states('climate.bedroom') != 'off' }}"
        sequence:
          - action: timer.start
            target:
              entity_id: timer.bedroom_ac
            data:
              duration: "{{ (states('input_number.bedroom_ac_minutes') | int) * 60 }}"
      # Se cumplió el tiempo: apagar
      - conditions:
          - condition: trigger
            id: finished
        sequence:
          - action: climate.turn_off
            target:
              entity_id: climate.bedroom
      # Lo apagaron a mano antes: cancelar la cuenta
      - conditions:
          - condition: trigger
            id: manual_off
          - condition: state
            entity_id: timer.bedroom_ac
            state: active
        sequence:
          - action: timer.cancel
            target:
              entity_id: timer.bedroom_ac
```

Dos detalles que te evitan problemas. `above: 0` impide que un temporizador de
cero minutos termine al instante y apague el aire apenas aprietas el botón. Y
`not_from: [unavailable, unknown]` evita que una reconexión cancele una cuenta en
curso.

Para un aire sin entidad `climate`, cambia `climate.turn_off` por
`input_boolean.turn_off` y apunta las condiciones a ese boolean.

### 3. Apunta la tarjeta a ellos

```yaml
timer:
  entity: timer.bedroom_ac                       # obligatorio
  minutes_entity: input_number.bedroom_ac_minutes
  button_entity: input_button.bedroom_ac_timer   # opcional, pero recomendado
```

Detenido, muestra los minutos con `−` / `+` (respeta `step`, `min` y `max` del
`input_number`) y un botón **Programar**. Corriendo, muestra la cuenta regresiva
y el botón pasa a **Cancelar**.

`button_entity` es opcional, pero conviene ponerlo: al apretarlo dispara *tu*
`input_button`, así que tu automatización sigue al mando y aplica sus
validaciones. Sin él, la tarjeta llama `timer.start` directo y se las salta. Y
aun así necesitas la automatización para la parte de `timer.finished`.

La cuenta regresiva se calcula en el navegador a partir de `finishes_at`, con un
intervalo que solo corre mientras el temporizador está activo. Nada de sensores
de plantilla escribiendo cada segundo en el recorder.

---

## Selector de modo (frío / calor)

Para aires por IR sin entidad `climate`. `modes` dibuja **Apagado / Frío /
Calor** y marca el activo. Con un solo modo queda como un simple prender y
apagar.

Cada modo es una entidad: un `input_boolean` o `switch`, o un `scene`, `script`,
`button` o `input_button`.

Con `modes` y sin `base_card`, la tarjeta no envuelve nada y se dibuja entera por
su cuenta.

### Un boolean por modo

```yaml
type: custom:ac-room-card
name: Pieza niños
entity: input_boolean.kids_ac
modes:
  - name: Frío
    entity: input_boolean.kids_ac
    icon: mdi:snowflake
  - name: Calor
    entity: input_boolean.kids_ac_heat
    icon: mdi:fire
```

Al cambiar de modo, **apaga primero los otros booleans y después prende el
elegido**. El orden importa: si cada boolean dispara una escena IR, hacerlo al
revés deja el aire apagado, porque el "off" del modo anterior llega después del
"on" del nuevo.

> Cada boolean tiene que estar conectado a lo que realmente maneja el aire: una
> escena, un `remote.send_command`, lo que uses. La tarjeta cambia el boolean; no
> sabe mandar IR.

### Una escena por modo

Si cada modo ya es una escena, un script o un botón que manda el código IR,
apunta la tarjeta directo a ellos. Sin booleans de ayuda y sin automatización:

```yaml
type: custom:ac-room-card
name: Living
modes:
  - name: Frío
    entity: scene.living_ac_cool
    icon: mdi:snowflake
  - name: Calor
    entity: scene.living_ac_heat
    icon: mdi:fire
off_entity: scene.living_ac_off
power_entity: sensor.living_ac_power
```

Tocar un modo dispara su entidad. **Apagado** dispara `off_entity`.

Las escenas, los scripts y los botones no tienen estado prendido o apagado, así
que la tarjeta marca como activo el que se disparó **más recientemente**. Las
escenas y los botones guardan como estado la hora de su última activación; los
scripts tienen `last_triggered`. Si lo más reciente es `off_entity`, el aire se
ve apagado.

- Si todos los modos son escenas, scripts o botones y no hay `off_entity`, el
  botón **Apagado** se oculta: no hay nada que disparar.
- Se pueden mezclar. Un boolean prendido siempre gana.

En el editor visual son los campos **Frío**, **Calor** y **Apagar**, en la sección
**Aire IR**.

La lista de piezas usa lo mismo: su botón de encendido dispara el primer modo
para prender y `off_entity` para apagar.

### Varias escenas por modo (flechas de temperatura)

Un control IR no manda "pon 22 °C": cada temperatura es un código distinto, así
que normalmente es su propia escena. Dale al modo todas en `steps` y la tarjeta
muestra **▼ 22° ▲** al lado de los botones de modo mientras ese modo está en
marcha:

```yaml
type: custom:ac-room-card
name: Living
modes:
  - name: Frío
    entity: scene.living_ac_cool
    icon: mdi:snowflake
  - name: Calor
    icon: mdi:fire
    steps:
      - scene.living_ac_heat_20
      - scene.living_ac_heat_22
      - scene.living_ac_heat_24
off_entity: scene.living_ac_off
```

- **La temperatura** de cada paso es el último número del nombre de la escena
  (*Living aire calor 22* → 22°). Si los nombres no la traen, ponla tú:
  `- { entity: scene.living_ac_heat_suave, temp: 20 }`. Un `name` en el paso
  reemplaza el rótulo completo.
- **Orden.** Si todos los pasos tienen temperatura, se ordenan de menor a mayor:
  ▲ siempre sube, en el orden que sea que los hayas puesto. Sin números, se usa
  el orden de la lista.
- **Turbo y swing.** Una escena con *turb* en cualquier parte del nombre o del
  entity_id (*turbo*, o pegado y abreviado como *AireLiving23hotTurbSwing*) lleva
  una **T**; una con *swing*, una **S**. A igual temperatura van normal → S → T
  → TS, así que ▲ recorre las variantes antes de pasar al grado siguiente:
  23° → 23° S → 23° T → 23° TS → 24°. Si el nombre no lo dice, pon
  `turbo: true` o `swing: true` en el paso. En la lista de piezas, la columna
  Target las muestra pegadas: **23°TS**.
- **Qué paso está activo** se calcula igual que cualquier modo por escena: el
  que se disparó más recientemente. Las flechas se deshabilitan en los extremos
  y se esconden si el modo en marcha tiene una sola escena o el aire está
  apagado.
- **Al tocar el modo** vuelve al paso que usaste la última vez en él (el más
  bajo, si nunca se usó).

En el editor visual, elige varias escenas en **Frío** o **Calor**:
aparece un campo de temperatura para cada una; vacío quiere decir "sácala del
nombre".

En la lista de piezas, la columna **Target** muestra la temperatura del paso en
marcha, y el popup trae las flechas.

---

## Vista compacta

```yaml
base_view: compact
```

Cambia el dial grande del termostato por una fila delgada de
[mini-climate](https://github.com/artem-sedykh/mini-climate-card), con rótulos
chicos **TARGET** / **ACTUAL** sobre las dos temperaturas y la velocidad del
ventilador del aire en la misma línea. Es la vista de la captura de arriba, sin
escribir a mano los bloques `base_card` y `base_card_style`.

En el editor visual es el desplegable *Vista de arriba*, y una tarjeta agregada
desde la interfaz parte en `compact` si mini-climate está instalado. Necesita
mini-climate de HACS; sin él, la tarjeta vuelve al termostato integrado en vez de
mostrar un error. `decimals` fija la precisión de las temperaturas, un decimal
por defecto.

Un `base_card` escrito a mano siempre gana, y un `base_card_style` propio
reemplaza los rótulos que trae. En la tarjeta de piezas, `base_view` vale para el
popup de cada pieza que no traiga el suyo.

---

## Botones de modo

Con el termostato integrado arriba (lo normal), la tarjeta muestra bajo el dial
la fila de botones de modo del propio Home Assistant: apagado, calor, frío, seco,
ventilador... Es la misma fila que muestra la tarjeta de termostato nativa con la
función `climate-hvac-modes`, y solo lista los modos que la entidad declara en
su `hvac_modes`. Ya no hace falta abrir el diálogo de más información para
cambiar de modo.

```yaml
mode_buttons: false   # oculta la fila
```

También es un interruptor en el editor visual. Si pones `features:` tú mismo, se
usa tu lista en su lugar.

---

## Envolver otra tarjeta

```yaml
base_card:
  type: custom:mini-climate
  fan_mode:
    hide: false
```

`base_card` acepta la config completa de cualquier tarjeta, de HACS o integrada.
Sin él, se usa el `thermostat` integrado para las entidades `climate` y un `tile`
para lo demás. Si `base_card` no trae `entity`, hereda la de arriba.

### Retocar la tarjeta envuelta

Una tarjeta de HACS vive en su propio shadow DOM, así que tu CSS no la alcanza.
`base_card_style` inyecta CSS ahí adentro. Como **mapa**, cada clave es el
selector de un elemento con shadow root propio, y la clave vacía es la raíz de la
tarjeta envuelta:

```yaml
base_card_style:
  "": |
    .mc-climate { padding-top: 0 !important; }
  mc-temperature: |
    .state__value:nth-of-type(1)::before { content: "Target"; }
```

Los elementos anidados se montan después que la tarjeta, así que la inyección
reintenta hasta encontrarlos.

---

## Idioma

Todos los textos de las dos tarjetas, y los dos editores visuales, siguen el
idioma del usuario de Home Assistant: español si es `es` (o cualquier `es-*`),
inglés para todo lo demás. `labels` sigue reemplazando cualquier texto de la
tarjeta.

---

## Problemas comunes

**El editor visual dice que no está disponible.** Casi seguro tienes la tarjeta
cargada dos veces. Revisa en Ajustes → Paneles de control → Recursos si hay una
entrada `/local/` y otra `/hacsfiles/`, y borra una.

**Una actualización parece no aplicarse.** La misma causa, o la caché del
navegador. Recarga con Ctrl+Shift+R.

**El ícono del ventilador nunca cambia de color.** Se arregló en la 0.14.0.
Actualiza.

**No aparece nada al lado de la potencia.** Cada elemento se oculta si falta su
entidad. Revisa los IDs de entidad en el editor visual.

---

## AC Rooms Card

Una lista compacta, una línea por pieza, para el panel del celular, donde seis
tarjetas completas son seis pantallas de scroll.

<img src="docs/rooms-card.png" alt="AC Rooms Card" width="470">

Seis piezas, una línea cada una. Dos no tienen entidad `climate`: son aires por
IR manejados con un `input_boolean`, así que solo llenan la columna **Real**.

```yaml
type: custom:ac-rooms-card
title: Aire acondicionado
columns: [temps, power]   # opcional: deja la línea con lo esencial
rooms:
  - entity: climate.bedroom
    name: Dormitorio
    power_entity: sensor.bedroom_ac_power
    temp_entity: sensor.bedroom_temperature
    lux_entity: sensor.bedroom_illuminance
    window_entity: [binary_sensor.bedroom_window]
    fans: [fan.bedroom_ceiling]
    timer:
      entity: timer.bedroom_ac
      minutes_entity: input_number.bedroom_ac_minutes
      button_entity: input_button.bedroom_ac_timer
  - entity: input_boolean.kids_ac
    name: Pieza niños
    modes:
      - entity: input_boolean.kids_ac
      - entity: input_boolean.kids_ac_heat
```

**Si no pones `rooms`, las encuentra sola.** Lee el panel buscando cada
`custom:ac-room-card` que tengas, incluidas las que están dentro de un
`stack-in-card`. Basta con agregar una pieza a una vista para que aparezca acá
también. `discover_view: <path>` limita la búsqueda a una vista, y `exclude` saca
las que no quieres:

```yaml
type: custom:ac-rooms-card
discover_view: climate
exclude: [Garaje, Terraza]
```

Cada entrada coincide con el `name` o la `entity` de una pieza. También se aplica
a una lista `rooms` escrita a mano.

**Las dos tarjetas tienen editor visual**, y el de piezas te deja editar cada
pieza sin el editor de código. Ver
[Editar las piezas desde la interfaz](#editar-las-piezas-desde-la-interfaz).

O lístalas tú. Cada pieza lleva **el mismo bloque que `ac-room-card`**, así que
puedes copiar directo la config de una tarjeta. Campos que usa: `entity`, `name`,
`power_entity`, `temp_entity`, `lux_entity`, `window_entity` (con pila), `fans`,
`power_switch` (ver [Cortar la corriente desde la lista](#cortar-la-corriente-desde-la-lista)),
`modes`, `off_entity`, `timer`, `battery_warn`, `decimals`.

`decimals` también va en la tarjeta de piezas, para todas las filas a la vez. Sin
él, las temperaturas se redondean a un decimal como máximo, así que `24` y `23.5`
quedan lado a lado; `decimals: 1` muestra `24.0`. El `decimals` de cada pieza
gana, y el popup hereda el de la lista. `base_view` funciona igual para el popup.

Un temporizador corriendo muestra la cuenta regresiva en naranjo; tócalo para
cancelar. Detenido, es solo un ícono que tocas para arrancarlo, y se oculta
cuando la pieza está apagada, porque no hay nada que programar.

| Elemento | Al tocar |
|---|---|
| Botón de encendido | Prende o apaga la pieza |
| Nombre o temperaturas | Abre la tarjeta completa de la pieza en un popup (`popup: false` para abrir más información) |
| Potencia | Más información del sensor de potencia |
| Ícono de ventana | Más información de la primera ventana abierta |
| Temporizador | Lo arranca (o cancela uno que está corriendo) |
| Ícono de enchufe | Corta la corriente de la pieza: dos toques, igual que en la tarjeta completa |
| Íconos de ventilador | Prende o apaga ese ventilador |

`columns` elige qué muestra la línea, entre `temps`, `power`, `plug`, `lux`,
`window`, `timer` y `fans`. Todas vienen activas salvo `lux` y `plug`: la mayoría
de las piezas no tiene sensor de luz, y una columna vacía en cada fila solo quita
espacio. En el celular `[temps, power]` es lo que mejor se lee: los nombres dejan
de cortarse y todo lo demás queda a un toque, en el popup.

Las columnas tienen ancho fijo, y la de ventiladores toma el ancho de la pieza
que tiene más. Así cada ícono cae en el mismo lugar a lo largo de la lista, en
vez de moverse según lo que traiga cada fila. Una pieza sin ventana o sin
temporizador deja su espacio vacío en vez de correr todo a la izquierda.

Tocar el nombre de una pieza abre **la `ac-room-card` completa en un popup**,
armada con la config de esa pieza. La línea se mantiene legible en el celular y
el detalle queda a un toque. Pon `popup: false` en la tarjeta para abrir el
diálogo de más información.

Tres temperaturas, separadas a propósito:

| Columna | De dónde sale |
|---|---|
| **Target** | la temperatura fijada en el aire (`temperature`) |
| **Actual** | lo que mide **el propio aire** (`current_temperature`) |
| **Real** | tu sensor de la pieza (`temp_entity`) |

Las dos últimas rara vez coinciden: el aire mide dentro de su carcasa, muchas
veces con un par de grados de diferencia respecto del centro de la pieza. Verlas
lado a lado es justamente la gracia. Renómbralas con
`labels: {target, actual, real}`.

Los rótulos se dibujan **una sola vez**, como encabezado de columna, con un ícono
chico sobre las columnas de potencia, temporizador, ventana y ventiladores.
Repetirlos en cada fila sería ruido.

En pantallas angostas las columnas se aprietan en vez de sacar la potencia: en el
celular, lo que está consumiendo el aire en este momento es de lo que más quieres
ver. Las ventanas y las pilas usan la misma lógica verde/naranjo/rojo que la
tarjeta completa. Bajo 380 px la columna de potencia se oculta para que la línea
se siga leyendo.

### Editar las piezas desde la interfaz

El editor visual de la tarjeta de piezas tiene un selector **Piezas** con dos
opciones:

- **Buscarlas en el panel**: el descubrimiento automático de arriba. No escribe
  la clave `rooms`. El editor te ofrece tus vistas en un desplegable y tus piezas
  como casillas para excluir.
- **Listarlas acá**: el editor escribe `rooms`. Cada pieza es un panel que se
  abre y se cierra, con **los mismos campos que el editor de `ac-room-card`**
  (entidad de clima, nombre, sensor de potencia, temperatura, luz, decimales,
  enchufe, ventanas, ventiladores, modos, temporizador...) y un botón para
  quitarla. El selector de entidad de abajo agrega una pieza. Para un aire por
  IR sin entidad `climate`, elige su escena, script o botón de frío: la pieza se
  crea con ese modo y el resto lo completas en su panel.

Al pasar a *Listarlas acá*, la lista parte con las piezas que había descubierto,
así que empiezas desde lo que ya tienes. Si quitas la última pieza, vuelve a
*Buscarlas en el panel*. Ya no hace falta usar el editor de código.

### Cortar la corriente desde la lista

Dale a la pieza su `power_switch` y agrega `plug` a `columns` (viene desactivada
por defecto):

```yaml
type: custom:ac-rooms-card
columns: [temps, power, plug]
rooms:
  - entity: climate.bedroom
    name: Dormitorio
    power_entity: sensor.bedroom_ac_power
    power_switch: switch.bedroom_ac_plug
```

El ícono del enchufe queda justo después de los watts. Corta con dos toques y
repone con uno, igual que en la tarjeta completa: ver
[Cortar la corriente](#cortar-la-corriente). Con descubrimiento automático no
tienes que agregar nada a las piezas: cada una trae el `power_switch` de su
propia tarjeta, así que basta con `columns`.

### Color de la fila según el modo

Una pieza andando tiñe toda su fila: **celeste para frío, naranjo para calor**, y
un tono verde para `dry`. Las piezas apagadas quedan neutras. El botón de
encendido toma el mismo color, así que de un vistazo sabes qué está haciendo cada
aire, sin leer nada.

En piezas con modos `input_boolean`, el modo se deduce del nombre o del entity id
(`cool`/`frio`, `heat`/`calor`/`calef`). Si los nombres no lo dejan claro, dilo
explícito:

```yaml
modes:
  - entity: input_boolean.kids_ac
    name: Frío
    hvac: cool
  - entity: input_boolean.kids_ac_heat
    name: Calor
    hvac: heat
```

`sort: active` pone arriba las piezas que están andando. **Si no lo pones, se
mantiene tu orden.** Con él, las filas saltan cuando las piezas se prenden y
apagan, y eso desorienta cuando estás apuntando a un botón.

## Desarrollo

```bash
node test/smoke.js        # la tarjeta de pieza: línea de datos, ventanas, ventiladores, temporizador, editor
node test/discover.js     # descubrimiento y editor de piezas
node test/base_view.js    # la vista de arriba elegida desde el editor
node test/modes_i18n.js   # modos con escenas y botones, botones de modo e idioma
node test/steps.js        # varias escenas por modo y las flechas de temperatura
```

Sin navegador: un shim mínimo de DOM prueba el formato de los valores, que los
elementos se oculten cuando falta su entidad, los sensores no disponibles, los
estados de ventana y la pila, el cambio de los ventiladores, la cuenta regresiva
del temporizador y las llamadas a servicios, y la ida y vuelta de la config en el
editor visual.

No hay compilación. Edita `ac-room-card.js`, corre los tests y haz commit.

## Licencia

MIT. Ver [LICENSE](LICENSE).
