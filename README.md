# AC Room Card

Card de Lovelace para Home Assistant que toma el card `thermostat` integrado y
le agrega, debajo, una linea compacta: un rayo, los **watts** que esta
consumiendo y, al lado, el **simbolo de la ventana** de la pieza — **verde si
esta cerrada, rojo si esta abierta** — y, opcional, la **temperatura** de la
pieza. Sin etiquetas de texto.

```
⚡  12 W  ⬜  🌡 22,6 °C
```

Opcionalmente, una segunda linea con la energia consumida.

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
| `entity` | string | si | Entidad `climate.*`. Tambien acepta `input_boolean.*` / `switch.*`: en ese caso dibuja un `tile` en vez del termostato. |
| `name` | string | no | Nombre mostrado. |
| `power_entity` | string | no | Sensor de potencia (W). |
| `energy_today_entity` | string | no | Sensor de energia del dia. |
| `energy_month_entity` | string | no | Sensor de energia del mes. |
| `window_entity` | string | no | `binary_sensor` de la ventana. `on` = abierta (rojo), `off` = cerrada (verde). Se dibuja en la misma linea de la potencia. |
| `temp_entity` | string | no | Sensor de temperatura de la pieza. Se dibuja a la derecha del simbolo de ventana. |
| `show_warning` | bool | no | `false` por defecto. Si lo activas, agrega un aviso de texto cuando la ventana esta abierta *y* el aire andando. El icono rojo ya cubre el caso, por eso viene apagado. |
| `base_card` | map | no | Config completa del card que va arriba. Sirve para envolver cualquier card, propio o de HACS (`custom:mini-climate`, `custom:simple-thermostat`...). Si no lo pones, usa el `thermostat` integrado. |
| `features` | list | no | Se pasa tal cual al `thermostat` integrado. Se ignora si usas `base_card`. |
| `labels` | map | no | Sobrescribe los textos (`today`, `month`, `window`, `open`, `closed`, `warn`, `unavailable`). |

Cada cosa se oculta sola si no le pasas su entidad: sin `window_entity` no hay
icono, sin `power_entity` no hay numero, sin sensores de energia no hay segunda
linea. Sirve igual en una pieza que tiene todo y en una que solo tiene potencia.

Los colores salen de las variables del tema (`--success-color`, `--error-color`),
asi que respetan el tema claro/oscuro.

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
