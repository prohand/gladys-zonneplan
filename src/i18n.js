// -----------------------------------------------------------------------------
// The languages every user-facing text is written in.
//
// Gladys renders a multi-language object in the reader's own language and
// falls back to English for any other one. Every message this integration
// returns — action answers, connection status, widget texts — is such an
// object, with one key per language below. Sentences built from variable
// parts are written once per language through `localize`, and the parts
// choose their wording with `pick`.
// -----------------------------------------------------------------------------

/** The languages of the Gladys interface, English first: it is the fallback. */
export const LANGUAGES = ['en', 'fr', 'de', 'es'];

/**
 * The text of one language, English when the object has none for it.
 *
 * @param {string} language a key of {@link LANGUAGES}, or anything else
 * @param {Record<string, string>} texts one text per language, `en` included
 * @returns {string}
 */
export function pick(language, texts) {
  return texts[language] ?? texts.en;
}

/**
 * One multi-language object, built by calling `build` once per language.
 *
 * @param {(language: string) => string} build the text in one language
 * @returns {Record<string, string>} `{ en, fr, de, es }`
 */
export function localize(build) {
  return Object.fromEntries(LANGUAGES.map((language) => [language, build(language)]));
}

// Zonneplan only serves the Netherlands: its prices, slots and "today" are
// those of Amsterdam, whatever the timezone of the container.
export const ZONNEPLAN_TIME_ZONE = 'Europe/Amsterdam';

/** `HH:mm` of an instant, on the Zonneplan clock. */
export function formatTime(instant) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONNEPLAN_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

/** `YYYY-MM-DD` of an instant, on the Zonneplan clock. */
export function formatDate(instant) {
  // en-CA prints ISO dates.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONNEPLAN_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant));
}

/** A price in euros with three decimals: 0.231, -0.012. */
export function formatPrice(price) {
  return price.toFixed(3);
}
