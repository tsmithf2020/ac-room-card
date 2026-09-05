# AC Room Card

[![hacs](https://img.shields.io/badge/HACS-Custom-41BDF5.svg)](https://github.com/hacs/integration)
![version](https://img.shields.io/badge/version-0.8.0-blue.svg)

Card de Lovelace para Home Assistant que toma el card `thermostat` integrado y
le agrega, debajo, una linea compacta: un rayo, los **watts** que esta
consumiendo y, al lado, el **simbolo de la ventana** de la pieza — **verde si
esta cerrada, rojo si esta abierta** — y, opcional, la **temperatura** de la
pieza. Sin etiquetas de texto.

```
⚡  12 W  ⬜  🌡 22,6 °C
```

Opcionalmente, una segunda linea con la energia consumida y un **temporizador
de apagado** integrado, para no tener que armarlo con tres cards apiladas.

No copia codigo de Home Assistant. Instancia el card integrado en tiempo de
ejecucion via `loadCardHelpers()`, asi que hereda su comportamiento, sus
traducciones y sus actualizaciones sin quedar acoplado a modulos internos del
frontend.

## Instalacion

### HACS (repositorio personalizado)
1. HACS -> Frontend -> menu (arriba a la derecha) -> *Custom repositories*.
2. URL del repo, categoria **Dashboard** (o *Lovelace*, segun la version).
3. Instalar y recargar el navegador.

### Manual
1. Copiar `ac-room-card.js` a `/config/www/ac-room-card/`.
2. Ajustes -> Paneles -> menu -> *Recursos* -> Anadir:
   URL `/local/ac-room-card/ac-room-card.js`, tipo **Modulo JavaScript**.
3. Recargar el navegador con Ctrl+Shift+R.

## Uso

Se puede configurar **desde la interfaz**: al agregar el card aparece el editor
visual con selectores de entidad ya filtrados (potencia y energia por
`device_class`, temperatura por `device_class`, etc.). El YAML de abajo sigue
siendo valido y es lo que el editor produce.

> `base_card` no se edita en el formulario, pero **se conserva** al guardar
> desde la UI. Para cambiarlo, usa el editor YAML del card.


```yaml
type: custom:ac-room-card
entity: climate.dormitorio
name: Dorm
power_entity: sensor.ac_dorm_potencia
window_entity: binary_sensor.ventana_dorm_contact
temp_entity: sensor.temp_dorm
energy_today_entity: sensor.ac_dorm_energy_daily   # opcional
energy_month_entity: sensor.ac_dorm_energy_monthly # opcional
features:
  - type: climate-fan-modes
    style: dropdown
  - type: climate-hvac-modes
```

### Opciones

| Opcion | Tipo | Req. | Descripcion |
|---|---|:--:|---|
| `name` | string | no | Nombre que se muestra como encabezado arriba del todo. Si lo pones, **no** se le pasa al card interno, para no verlo dos veces. |
| `icon` | string | no | Icono al lado del nombre. Sin esto no hay icono. |
| `entity` | string | si | Entidad `climate.*`. Tambien acepta `input_boolean.*` / `switch.*`: en ese caso dibuja un `tile` en vez del termostato. |
| `name` | string | no | Nombre mostrado. |
| `power_entity` | string | no | Sensor de potencia (W). |
| `energy_today_entity` | string | no | Sensor de energia del dia. |
| `energy_month_entity` | string | no | Sensor de energia del mes. |
| `window_entity` | string | no | `binary_sensor` de la ventana. `on` = abierta (rojo), `off` = cerrada (verde). Se dibuja en la misma linea de la potencia. |
| `temp_entity` | string | no | Sensor de temperatura de la pieza. Se dibuja a la derecha del simbolo de ventana. |
| `timer` | map | no | Temporizador de apagado integrado. Ver abajo. |
| `show_warning` | bool | no | `false` por defecto. Si lo activas, agrega un aviso de texto cuando la ventana esta abierta *y* el aire andando. El icono rojo ya cubre el caso, por eso viene apagado. |
| `base_card` | map | no | Config completa del card que va arriba. Sirve para envolver cualquier card, propio o de HACS (`custom:mini-climate`, `custom:simple-thermostat`...). Si no lo pones, usa el `thermostat` integrado. |
| `features` | list | no | Se pasa tal cual al `thermostat` integrado. Se ignora si usas `base_card`. |
| `labels` | map | no | Sobrescribe los textos (`today`, `month`, `window`, `open`, `closed`, `warn`, `unavailable`). |

Cada cosa se oculta sola si no le pasas su entidad: sin `window_entity` no hay
icono, sin `power_entity` no hay numero, sin sensores de energia no hay segunda
linea. Sirve igual en una pieza que tiene todo y en una que solo tiene potencia.

Los colores salen de las variables del tema (`--success-color`, `--error-color`),
asi que respetan el tema claro/oscuro.

### Temporizador integrado

> **Esto no funciona solo.** Home Assistant no trae temporizadores de apagado
> para climas: hay que crear tres ayudantes y una automatizacion. El card los
> dibuja y los opera, pero no los inventa. Abajo esta todo lo que necesitas.

#### 1. Crear los ayudantes

En `configuration.yaml` (o desde Ajustes -> Dispositivos y servicios ->
Ayudantes, si prefieres la interfaz). Cambia `dorm` por el nombre de tu pieza:

```yaml
input_number:
  apagado_aire_dorm:
    name: Apagado AC Dorm
    icon: mdi:hvac
    min: 0
    max: 480
    step: 30
    unit_of_measurement: min
    mode: slider

input_button:
  timer_ac_dorm:
    name: Timer AC Dorm
    icon: mdi:home-thermometer

timer:
  timer_ac_dorm_var:
    name: Timer AC Dorm Var
    duration: "00:00:00"
    restore: false
```

Se aplican sin reiniciar: Herramientas para desarrolladores -> ACCIONES ->
`input_number.reload`, `input_button.reload` y `timer.reload`.

#### 2. Crear la automatizacion

Es la que arranca la cuenta y la que efectivamente apaga el equipo:

```yaml
alias: AC - Auto-off con timer DORM
mode: restart
triggers:
  - trigger: state
    entity_id: input_button.timer_ac_dorm
    id: start
  - trigger: event
    event_type: timer.finished
    event_data:
      entity_id: timer.timer_ac_dorm_var
    id: finished
  - trigger: state
    entity_id: climate.dormitorio
    to: "off"
    not_from: [unavailable, unknown]
    id: manual_off
conditions: []
actions:
  - choose:
      # Arrancar, solo si el aire esta andando y hay minutos configurados
      - conditions:
          - condition: trigger
            id: start
          - condition: numeric_state
            entity_id: input_number.apagado_aire_dorm
            above: 0
          - condition: template
            value_template: "{{ states('climate.dormitorio') != 'off' }}"
        sequence:
          - action: timer.start
            target:
              entity_id: timer.timer_ac_dorm_var
            data:
              duration: "{{ (states('input_number.apagado_aire_dorm') | int) * 60 }}"
      # Se cumplio el tiempo: apagar
      - conditions:
          - condition: trigger
            id: finished
        sequence:
          - action: climate.turn_off
            target:
              entity_id: climate.dormitorio
      # Lo apagaron a mano antes: cancelar la cuenta
      - conditions:
          - condition: trigger
            id: manual_off
          - condition: state
            entity_id: timer.timer_ac_dorm_var
            state: active
        sequence:
          - action: timer.cancel
            target:
              entity_id: timer.timer_ac_dorm_var
```

Dos detalles que evitan sorpresas: la condicion `above: 0` impide que con cero
minutos el `timer.start` termine al instante y apague el equipo apenas aprietas
el boton; y `not_from: [unavailable, unknown]` evita que una reconexion del
equipo cancele un temporizador en curso.

Si tu equipo no tiene entidad `climate` y se controla con un `input_boolean`
(tipico de un IR por escenas), reemplaza `climate.turn_off` por
`input_boolean.turn_off` y ajusta las condiciones a ese `input_boolean`.

#### 3. Apuntar el card a los tres

```yaml
timer:
  entity: timer.timer_ac_dorm_var           # requerido
  minutes_entity: input_number.apagado_aire_dorm
  button_entity: input_button.timer_ac_dorm # opcional pero recomendado
```

Con el temporizador parado muestra los minutos con botones `-` / `+` (respeta
`step`, `min` y `max` del `input_number`) y un boton **Programar**. Corriendo,
muestra la cuenta regresiva y el boton pasa a **Cancelar**.

`button_entity` es opcional pero conviene: al apretarlo dispara tu
`input_button`, asi **la automatizacion sigue siendo la que manda** y aplica sus
validaciones. Sin el, el card llama `timer.start` directo saltandose esas
comprobaciones — y ojo, en ese caso igual necesitas la automatizacion del paso 2
para la parte de `timer.finished`, porque el card **no apaga el equipo**: solo
maneja la cuenta.

La cuenta regresiva se calcula en el navegador desde `finishes_at`, con un
`setInterval` que solo corre mientras el temporizador esta activo. No necesita
un sensor de plantilla refrescando cada segundo ni escribe nada en el recorder.

### Envolver otro card como base

`base_card` acepta la config completa de cualquier card. Util si ya usas
`mini-climate-card`, `simple-thermostat` u otro y solo quieres agregarle las
filas de abajo:

```yaml
type: custom:ac-room-card
entity: climate.dormitorio
power_entity: sensor.ac_dorm_potencia
window_entity: binary_sensor.ventana_dorm_contact
temp_entity: sensor.temp_dorm
base_card:
  type: custom:mini-climate
  fan_mode:
    hide: true
```

Si `base_card` no trae `entity`, hereda la de arriba.

### Sin entidad climate

Para un equipo controlado por IR con un `input_boolean` en vez de una entidad
`climate`, el card dibuja un `tile` arriba y mantiene las mismas filas:

```yaml
type: custom:ac-room-card
entity: input_boolean.ac_javi
name: Javi
power_entity: sensor.ac_javi_potencia
energy_today_entity: sensor.ac_javi_energy_daily
window_entity: binary_sensor.javi_ventana_contact
```

## Licencia

MIT. Ver [LICENSE](LICENSE).

## Tests

```bash
node test/smoke.js
```

Ejercita la logica de las filas (valores, unidades, entidades ausentes o
`unavailable`, el aviso de ventana) con un shim minimo de DOM, sin navegador.
