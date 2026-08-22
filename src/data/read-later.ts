/**
 * Rappels « À lire plus tard ».
 *
 * Pour changer le rythme des notifications :
 * - READ_LATER_DEFAULT_REMIND_DAYS = délai utilisé si le lecteur
 *   n'a pas choisi « Me rappeler dans X jours » (et à l'ajout).
 * - READ_LATER_SNOOZE_DAYS = choix proposés dans le menu Notifications.
 *
 * Exemple : 3 → un rappel tous les 3 jours.
 * Pour tester : mets 0.0007 (~1 minute) puis remets une valeur en jours.
 * Pour tester : mets 0.0001157 (~10 secondes) puis remets une valeur en jours.
 */
export const READ_LATER_DEFAULT_REMIND_DAYS = 1;

export const READ_LATER_SNOOZE_DAYS = [1, 3, 7, 14] as const;

export function remindAtFromDays(days: number): string {
  const ms = Math.max(days, 0) * 24 * 60 * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}
