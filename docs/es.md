# Zonneplan para Gladys Assistant

Esta integración lleva su cuenta [Zonneplan](https://www.zonneplan.nl) a Gladys: los precios
dinámicos de la luz y del gas, y los equipos que Zonneplan supervisa — contador P1
(Zonneplan Connect), paneles solares, batería doméstica (Nexus) y punto de recarga.

Habla con los servidores de Zonneplan por Internet (**cloud**): no hay nada que instalar en
su red. Necesita **Gladys 5.1 o posterior**.

## Iniciar sesión

Zonneplan no tiene contraseña: le envía un código de un solo uso por e-mail.

1. En **Integraciones → Zonneplan → Configuración**, introduzca el e-mail de su cuenta
   Zonneplan y **guarde**.
2. Pulse **Enviarme un código de acceso**. Zonneplan le envía un código por e-mail.
3. Escriba el código en **Iniciar sesión con el código** y confirme. El código es válido
   unos minutos: si ha caducado, pida otro.

La respuesta bajo el botón indica lo que se ha encontrado en su cuenta. Después la sesión se
renueva sola; solo hay que volver a iniciar sesión si se cierra (por ejemplo desde la app
Zonneplan). **Probar la conexión** comprueba la sesión en cualquier momento, **Cerrar
sesión** la borra de Gladys.

## Ajustes

| Ajuste                         | Qué hace                                                                                                                                                                                        |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E-mail de la cuenta Zonneplan  | La dirección a la que se envía el código de acceso.                                                                                                                                             |
| Tramos de precio               | **Por hora** (por defecto) o **por cuarto de hora**: desde octubre de 2025 el mercado fija un precio cada 15 minutos; Zonneplan también publica medias horarias.                                |
| Intervalo de actualización (s) | Cada cuánto se leen el contador P1, los paneles, la batería y el punto de recarga (de 60 a 3600 s, 300 por defecto). Zonneplan limita las consultas: deje 300 s salvo que necesite más rapidez. |

## Dispositivos

Abra la pestaña **Descubrimiento** de la integración y cree los dispositivos que quiera. Hay
un dispositivo por instalación de su cuenta:

| Dispositivo                 | Funciones                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Zonneplan electricity price | Precio por kWh ahora, precio del tramo siguiente, grupo tarifario (`low` / `normal` / `high`), energía sostenible (%) |
| Zonneplan gas price         | Precio por m³ hoy, precio del día siguiente (en cuanto se conoce)                                                     |
| Zonneplan P1 meter          | Potencia tomada de la red, potencia devuelta a la red (W)                                                             |
| Zonneplan solar panels      | Potencia producida (W), producción total (kWh)                                                                        |
| Zonneplan home battery      | Nivel de la batería (%), potencia de carga, potencia de descarga (W)                                                  |
| Zonneplan charge point      | Potencia de carga (W), energía de la sesión (kWh), interruptor **Charge now (boost)**                                 |

Los precios incluyen IVA e impuestos, como en la app Zonneplan. El precio de la luz cambia
justo al comienzo de cada tramo. Las lecturas P1 y solares llegan por la nube de Zonneplan
cada pocos minutos: no son lecturas al segundo.

El interruptor **Charge now** inicia una carga inmediata (plena potencia ya, sea cual sea el
precio); apagarlo detiene la carga. Fuera de una carga inmediata, Zonneplan carga por sí
mismo en las horas baratas, y el interruptor está en ON mientras dura esa carga.

Cada dispositivo lleva una insignia **cloud**. Un punto naranja en ella indica que Zonneplan
ha pedido reducir las consultas durante un tiempo; los datos vuelven solos.

## Escenas

### Disparadores

| Disparador                             | Cuándo                                                                    | Variables                                          |
| -------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- |
| Cambio de tramo tarifario Zonneplan    | El nuevo tramo está en otro grupo; filtro por grupo                       | nuevo grupo, grupo anterior, precio                |
| Precio Zonneplan negativo              | El precio de la luz acaba de bajar de cero                                | precio, fin del tramo (HH:mm)                      |
| Precios Zonneplan de mañana publicados | Se conocen los precios de mañana (normalmente por la tarde)               | fecha, tramo y precio más barato y más caro, media |
| Recarga Zonneplan iniciada / detenida  | Un punto de recarga empieza o deja de cargar; filtro por punto de recarga | potencia, energía de la sesión                     |

### Acciones

| Acción                                 | Qué hace                                                                                                                                                              |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Leer el precio Zonneplan               | Da el precio ahora y después, el grupo tarifario, la parte sostenible y el tramo más barato del día                                                                   |
| Buscar el periodo Zonneplan más barato | La serie de tramos consecutivos más barata de la duración pedida (en horas) en las próximas horas: inicio, fin, precio medio, «empieza en» (minutos), «empieza ahora» |
| Zonneplan: cargar ahora                | Carga inmediata en el punto de recarga elegido                                                                                                                        |
| Zonneplan: parar la recarga            | Detiene la carga del punto de recarga elegido                                                                                                                         |

Ejemplo — poner el lavavajillas en las 2 horas más baratas de la noche: una escena disparada
a las 22:00 ejecuta **Buscar el periodo Zonneplan más barato** (duración 2, dentro de 10),
espera **empieza en** minutos y enciende el enchufe del lavavajillas.

Ejemplo — cargar el coche cuando el precio sea negativo: disparador **Precio Zonneplan
negativo**, acción **Zonneplan: cargar ahora**.

Las horas (HH:mm) son las de los Países Bajos.

## Widgets

Añádalos desde **Panel → Editar → Añadir un widget**:

- **Precios Zonneplan**: precio ahora y después (en color según el grupo tarifario), parte
  sostenible, curva de precios de las próximas horas con el tramo más barato y más caro del
  día.
- **Resumen Zonneplan**: potencia de y hacia la red, producción solar, nivel de batería y
  potencia de carga en directo, la conexión, y los botones **Cargar ahora** / **Parar la
  recarga**.

## Solución de problemas

| Mensaje en la configuración          | Qué hacer                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------ |
| Sin sesión                           | Siga [Iniciar sesión](#iniciar-sesión).                                                    |
| La sesión de Zonneplan ha caducado   | Pida un nuevo código: la sesión se cerró o es demasiado antigua.                           |
| Zonneplan pide reducir las consultas | Nada: las consultas se reanudan a la hora indicada. Aumente el intervalo si pasa a menudo. |
| No se puede contactar con Zonneplan  | Compruebe el acceso a Internet de Gladys; la integración reintenta cada minuto.            |

¿Falta un dispositivo? Compruebe en la app Zonneplan que su contrato está activo y pulse
**Buscar** en la pestaña Descubrimiento.

## Privacidad

La integración solo habla con `app-api.zonneplan.nl`. Los tokens de sesión se guardan en el
volumen de datos privado de la integración, legibles solo por ella, y nunca se escriben en
los registros. **Cerrar sesión** los borra. Esta integración no está hecha ni soportada por
Zonneplan; usa la misma API que la app Zonneplan.
