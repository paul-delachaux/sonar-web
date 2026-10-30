/**
 * API d’administration des annonces : recherche des comptes destinataires,
 * création et consultation des messages, et annulation ou suppression d’historique.
 * Toutes les opérations sont réservées aux superadmins et utilisent le client serveur.
 */
import type { APIRoute } from 'astro';
import { accountHasCmsLink } from '../../../utils/cms-accounts';
import { loadCmsFile } from '../../../utils/cms-accounts-store';
import { cmsGithubToken, requireCmsSuperadmin } from '../../../utils/admin-github';
import { createServiceClient } from '../../../utils/service-client';

export const prerender = false;

// Les annonces « all » n'ont pas de liste figée : le RPC les rend accessibles
// aussi aux comptes créés après leur programmation. Les autres audiences stockent
// ici des UUID de comptes existants au moment où le message est créé.
type AccountRow = { id: string; username: string; email: string };
type Audience = 'all' | 'selected' | 'admins';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Réponse JSON homogène et non mise en cache, notamment pour éviter d'exposer
// des résultats de recherche de comptes via un cache partagé.
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json' },
  });
}

function validAudience(value: unknown): value is Audience {
  return value === 'all' || value === 'selected' || value === 'admins';
}

async function listAccounts(admin: NonNullable<ReturnType<typeof createServiceClient>>) {
  const rows: AccountRow[] = [];
  const pageSize = 1000;
  // Supabase limite le nombre de lignes par réponse ; paginer permet de résoudre
  // les comptes Admin même si la table dépasse la limite d'une seule requête.
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin
      .from('accounts')
      .select('id, username, email')
      .order('username')
      .range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message || 'Impossible de charger les comptes.');
    const page = (data || []) as AccountRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

export const GET: APIRoute = async ({ request }) => {
  // Toutes les opérations vérifient le rôle superadmin côté serveur ;
  // la clé service_role n'est jamais transmise au navigateur.
  const auth = await requireCmsSuperadmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const admin = createServiceClient();
  if (!admin) return json({ message: 'La clé SUPABASE_SERVICE_ROLE_KEY manque.' }, 503);

  // La présence du paramètre `users` sélectionne le mode recherche. Si le terme
  // est trop court, ne pas interroger les profils pour des résultats inutiles.
  const search = new URL(request.url).searchParams.get('users');
  if (search !== null) {
    const query = search.trim().slice(0, 80);
    if (query.length < 2) return json({ users: [] });
    // Traiter %, _ et \ comme du texte littéral, pas comme des jokers SQL.
    const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    // Chercher dans le pseudo et l'e-mail en parallèle pour que les deux soient
    // utilisables dans le même champ de recherche.
    const [usernameResult, emailResult] = await Promise.all([
      admin.from('accounts').select('id, username, email').ilike('username', pattern).order('username').limit(20),
      admin.from('accounts').select('id, username, email').ilike('email', pattern).order('username').limit(20),
    ]);
    if (usernameResult.error || emailResult.error) {
      const error = usernameResult.error || emailResult.error;
      console.error('[admin/announcements] Account search failed:', error);
      return json({
        message: 'Impossible de rechercher les comptes.',
        detail: error.message,
        code: error.code,
        hint: error.hint,
      }, 500);
    }
    const unique = new Map<string, AccountRow>();
    // Un compte peut correspondre aux deux recherches ; dédupliquer par UUID,
    // puis renvoyer une liste triée et plafonnée pour l'interface.
    for (const account of [...(usernameResult.data || []), ...(emailResult.data || [])] as AccountRow[]) {
      unique.set(account.id, account);
    }
    return json({
      users: [...unique.values()]
        .sort((a, b) => a.username.localeCompare(b.username))
        .slice(0, 30),
    });
  }

  const { data, error } = await admin
    .from('admin_announcements')
    .select('id, title, body, audience, target_account_ids, published_at, created_at, created_by')
    .order('published_at', { ascending: false })
    .limit(100);
  if (error) return json({ message: error.message || 'Impossible de charger les messages.' }, 500);

  // Le panneau d'administration affiche les 100 messages les plus récents et
  // calcule le statut planifié à partir de l'heure courante du serveur.
  return json({
    announcements: (data || []).map((item) => ({
      id: item.id,
      title: item.title,
      body: item.body,
      audience: item.audience,
      recipient_count: item.audience === 'all' ? null : (item.target_account_ids || []).length,
      published_at: item.published_at,
      created_at: item.created_at,
      created_by: item.created_by,
      scheduled: new Date(item.published_at).getTime() > Date.now(),
    })),
  });
};

export const POST: APIRoute = async ({ request }) => {
  // Création et programmation des annonces, réservées aux superadmins.
  const auth = await requireCmsSuperadmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const admin = createServiceClient();
  if (!admin) return json({ message: 'La clé SUPABASE_SERVICE_ROLE_KEY manque.' }, 503);

  let payload: Record<string, unknown>;
  try {
    payload = await request.json();
  } catch {
    // Une requête non JSON ne doit pas parvenir aux validations ou à la base.
    return json({ message: 'Le formulaire est invalide.' }, 400);
  }

  // Ne faire confiance ni aux types ni aux valeurs reçues du navigateur :
  // normaliser les textes et valider la date avant de poursuivre.
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  const audience = payload.audience;
  const publishedAt = typeof payload.published_at === 'string' ? new Date(payload.published_at) : null;

  if (!title || title.length > 160) return json({ message: 'Le titre doit contenir de 1 à 160 caractères.' }, 400);
  if (!body || body.length > 5000) return json({ message: 'Le message doit contenir de 1 à 5 000 caractères.' }, 400);
  if (!validAudience(audience)) return json({ message: 'Le type de destinataires est invalide.' }, 400);
  if (!publishedAt || Number.isNaN(publishedAt.getTime())) return json({ message: 'La date de publication est invalide.' }, 400);

  let targetAccountIds: string[] = [];
  if (audience === 'selected') {
    // Vérifier les UUID, éliminer les doublons et confirmer auprès de Supabase
    // que tous les comptes choisis existent encore au moment de la création.
    const requestedIds = Array.isArray(payload.account_ids)
      ? [...new Set(payload.account_ids.filter((id): id is string => typeof id === 'string'))]
      : [];
    if (!requestedIds.length || requestedIds.some((id) => !UUID_PATTERN.test(id))) {
      return json({ message: 'Sélectionnez au moins un compte existant.' }, 400);
    }
    const { data, error } = await admin.from('accounts').select('id').in('id', requestedIds);
    if (error) return json({ message: 'Impossible de vérifier les comptes sélectionnés.' }, 500);
    targetAccountIds = (data || []).map((account) => account.id);
    if (targetAccountIds.length !== requestedIds.length) {
      return json({ message: 'Un ou plusieurs comptes sélectionnés ne sont plus disponibles.' }, 400);
    }
  } else if (audience === 'admins') {
    // Les administrateurs du CMS ne sont pas forcément des comptes du site :
    // on les résout grâce à la liste « siteAccess » (pseudo/e-mail), puis on
    // conserve les UUID trouvés pour figer cette audience à la création.
    let targetIds: string[];
    try {
      const cmsFile = await loadCmsFile(cmsGithubToken(request) || undefined);
      const accounts = await listAccounts(admin);
      targetIds = accounts
        .filter((account) => accountHasCmsLink(account, cmsFile.siteAccess))
        .map((account) => account.id);
    } catch (error) {
      return json({ message: error instanceof Error ? error.message : 'Impossible de résoudre les comptes admin.' }, 500);
    }
    targetAccountIds = targetIds;
    if (!targetAccountIds.length) {
      return json({ message: 'Aucun compte de site ne correspond aux pseudos ou e-mails enregistrés dans Comptes & droits.' }, 400);
    }
  }

  // Une date passée est acceptée : le RPC distribuera le message à la prochaine
  // consultation des notifications. toISOString conserve un instant UTC précis.
  const { data, error } = await admin
    .from('admin_announcements')
    .insert({
      title,
      body,
      audience,
      target_account_ids: targetAccountIds,
      published_at: publishedAt.toISOString(),
      created_by: auth.login,
    })
    .select('id')
    .single();

  if (error) return json({ message: error.message || 'Impossible de créer le message.' }, 500);
  return json({ ok: true, id: data.id }, 201);
};

export const DELETE: APIRoute = async ({ request }) => {
  // Cette route permet soit de supprimer l'historique déjà publié, soit
  // d'annuler un message planifié ; les deux opérations sont réservées aux superadmins.
  const auth = await requireCmsSuperadmin(request);
  if (!auth.ok) return json({ message: auth.message }, auth.status);

  const admin = createServiceClient();
  if (!admin) return json({ message: 'La clé SUPABASE_SERVICE_ROLE_KEY manque.' }, 503);

  const searchParams = new URL(request.url).searchParams;
  if (searchParams.get('history') === 'published') {
    // La suppression porte uniquement sur les annonces arrivées à échéance.
    // Les notifications déjà délivrées sont conservées : leur lien d'annonce
    // devient NULL grâce au ON DELETE SET NULL de la migration SQL.
    const { count, error } = await admin
      .from('admin_announcements')
      .delete({ count: 'exact' })
      .lte('published_at', new Date().toISOString());

    if (error) return json({ message: error.message || 'Impossible d’effacer l’historique.' }, 500);
    return json({ ok: true, deleted: count || 0 });
  }

  const id = searchParams.get('id') || '';
  if (!UUID_PATTERN.test(id)) return json({ message: 'Le message demandé est invalide.' }, 400);

  // Une annonce n'est annulable que si son heure n'est pas encore arrivée.
  // La condition côté base protège aussi contre une course au moment de l'envoi.
  const { data, error } = await admin
    .from('admin_announcements')
    .delete()
    .eq('id', id)
    .gt('published_at', new Date().toISOString())
    .select('id')
    .maybeSingle();

  if (error) return json({ message: error.message || 'Impossible d’annuler le message.' }, 500);
  if (!data) return json({ message: 'Ce message n’existe plus ou a déjà été publié.' }, 404);
  return json({ ok: true });
};
