/**
 * Maximum key name length. The form's `maxLength` and the server-side validation share this one
 * number — two separate copies would drift sooner or later (the form allows it, the server rejects
 * it, and the user just sees "save failed").
 */
export const API_KEY_NAME_MAX = 60;
