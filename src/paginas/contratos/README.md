# Pantalla: contratos

🟢 Escrita.

- `index.tsx` — la lista (`PantallaContratos`), con la columna «Cuotas» que
  delata el contrato al que se le olvidó el calendario, y el diálogo para
  generarlo más tarde.
- `FormularioContrato.tsx` — el alta desde una oportunidad en `05_separacion` o
  posterior. Es el único sitio del CRM donde alguien teclea un precio, y por eso
  exige la constancia de `constanciaDePrecioManual` cuando el precio no viene de
  un parámetro confirmado.
- `CalendarioCuotas.tsx` — el generador de cuotas, compartido por los dos.

**La unidad del contrato** (7 de octubre de 2026): la asignada a la oportunidad o, si no hay —lo
normal, porque ninguna pantalla asigna unidades—, la de su **separación viva**. Antes solo se miraba
la asignada y el contrato no se podía crear desde el CRM. Al guardarlo con su separación, la base
la pasa a `aplicada_a_contrato` y la unidad a `contratada` (`sql/17`).

🟡 El precio que se propone sigue siendo el de `precio_puesto_9m2`, no el nivel de precio propio de
la unidad (`sql/19`). Cambiarlo es una decisión de Dirección (qué precio se firma: el de lista de la
unidad o el pactado), no de esta pantalla.

Lógica: `src/lib/contratos.ts`. Ni un precio literal en ninguno de los tres.

🟡 `contratos` es la novena sección del menú y `01-documentacion\02-ESPECIFICACION-TECNICA.md`
§4 todavía enumera ocho. Falta actualizar ese documento.
