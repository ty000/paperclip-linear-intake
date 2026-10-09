# Pilote réel V1 — Hitza

Statut : proposition de recette sans effet. Le parcours L5 a passé sa
[qualification installée isolée après corrections](https://github.com/ty000/paperclip-council/blob/d12c1a1df5afcb4719273729a62d7bf662b04a5d/docs/linear-v1-audit-native.json) ; le pilote réel reste différé. Ce document
n’autorise aucune installation, activation, écriture Linear, exécution fournisseur, création
de branche distante, PR ou fusion.

## Cible fixée

- Paperclip recette : `http://127.0.0.1:3210`, société **e-ty local**
  `587884dc-195c-4555-8db9-9f3d9541b373`.
- Linear : projet **Hitza** `2554218f-40e6-4283-9b02-d61eaffba8df`, équipe
  `88812287-860b-4764-9eb6-5bc39ac9945d`, <https://linear.app/pezzoslabs/project/hitza-136b6ff01aff>.
- Git : `pezzoslabs/content-assistant`, base locale lue sans modification à
  `main@8677031484a7eb7d84dfcd28d137e093e50d7bad`. Le checkout partagé est derrière son
  origin et ne sera ni actualisé ni utilisé par les agents.
- Le projet Paperclip `f71bdbe1-0940-4d19-8d49-2e08737508a0` et son workspace primaire
  occupé restent inchangés et hors pilote.

## Entrée HTTPS du webhook

Le VPS n'est pas un prérequis technique : Linear exige une URL HTTPS publique,
qui peut aboutir au VPS ou à un tunnel vers la recette WSL. Au 9 octobre 2026,
la recette écoute sur `127.0.0.1:3210` et aucun processus/service de tunnel ou
proxy courant n'a été trouvé dans WSL. Cela ne prouve pas l'absence d'une entrée
côté Windows ou d'un proxy externe. L'utilisateur ne connaît pas d'URL existante.

Vérification opérateur : dans **Linear → Settings → API → Webhooks**, relever
seulement URL, état et équipe d'un éventuel webhook Paperclip. Ce relevé nécessite
un administrateur Linear ; ne pas copier le secret. Puis identifier le routage
correspondant côté hébergement, DNS ou tunnel, sans créer de nouveau webhook.

Si le VPS arrive prochainement, qualifier son URL HTTPS stable au lancement du
pilote. Pour un pilote avant ce déploiement, préparer un tunnel HTTPS limité à
`/api/plugins/2c0e40e8-a0f3-4333-acc0-046f1f4b063e/webhooks/linear-todo`
(ID installé à relire avant configuration), avec refus des autres routes. Le
proxy doit préserver le corps et les en-têtes signés Linear ; le hostname reçu
par Paperclip doit être compatible avec sa configuration privée. L'endpoint
webhook n'utilise pas une connexion Board interactive : la signature est vérifiée
par le plugin. Le PC et WSL doivent rester disponibles pendant le pilote.

Ne pas ajouter un second mécanisme de polling pour contourner cette entrée.
Le tunnel, son exposition et l'enregistrement du webhook sont des effets à
inclure dans l'autorisation du pilote, pas dans la livraison du code. Aucun de
ces effets n'a été réalisé. La qualification isolée utilise son propre serveur.

Priorité confirmée par l'utilisateur : terminer d'abord la vérification du flow
local ; ajouter l'entrée publique seulement si sa mise en place reste simple.
Paperclip fournit déjà le serveur HTTP WSL, aucun second serveur applicatif n'est
nécessaire. Aucun outil de tunnel courant n'est actuellement disponible dans le
PATH WSL observé (`cloudflared`, `ngrok`, `tailscale`, `caddy`).

Références : [webhooks Linear](https://linear.app/developers/webhooks),
[Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).

## Objets isolés proposés

Créer un nouveau projet Paperclip **Hitza · qualification campagne V1** dont le workspace
primaire est un worktree privé neuf, par exemple
`/home/davy-lp/.paperclip/workspaces/hitza-linear-v1-pilot`. Le créer depuis le SHA fixé
ci-dessus sur `codex/linear-campaign-v1-pilot-2026-10`; pousser cette branche dédiée puis faire
des deux PR leur base. Aucune PR ne cible `main` et aucune autre mission ne partage ce worktree.

Créer une petite milestone Linear **Paperclip V1 — deux livraisons documentaires**, sans
adopter de milestone existante, puis exactement quatre tickets neufs :

1. un ticket campagne hors milestone, passé en Todo seulement au signal de départ ;
2. un parent dans la milestone portant le critère transverse : le check local doit confirmer
   les deux preuves documentaires ensemble sur la tête intégrée ;
3. une feuille A, enfant du parent, ajoutant `docs/paperclip-pilot/source-contract.md` et
   `scripts/check-paperclip-pilot.mjs` ;
4. une feuille B, enfant du parent et bloquée par A, ajoutant
   `docs/paperclip-pilot/readback-contract.md` et complétant le même check pour les deux fichiers.

Le ticket campagne contient un unique bloc JSON balisé `paperclip-campaign`, avec
`schema: "linear-milestone-campaign.v1"`, l’UUID de la nouvelle milestone et ces
références explicites : PRD `docs/01-product/PRD.md`, version
`8677031484a7eb7d84dfcd28d137e093e50d7bad`, SHA-256
`5e158560e7efbae13a67455998da2a0953a0ad87f733b397bcfe882f806222d4` ; TAD
`docs/02-architecture/TAD.md`, même version, SHA-256
`f6995af0205d1f977e99e5b90468e0f0fa6c8377eb953042a7a61cf7c4c3dd8a`.
URLs exactes :
- PRD : `https://github.com/pezzoslabs/content-assistant/blob/8677031484a7eb7d84dfcd28d137e093e50d7bad/docs/01-product/PRD.md` ;
- TAD : `https://github.com/pezzoslabs/content-assistant/blob/8677031484a7eb7d84dfcd28d137e093e50d7bad/docs/02-architecture/TAD.md`.

Leurs contenus complets doivent être configurés dans `campaignSource.referenceDocuments`
avec ces URLs, versions et hashes ; un lien seul ne remplace pas les octets vérifiés.
Les descriptions du parent et des feuilles reprennent leurs critères, chemins possédés et
commande du check. Les descriptions humaines et relations restent ensuite en lecture seule.

## Parcours et preuves attendues

Après le Todo : lecture complète paginée, import/readback, admission exclusive, publication
relue du plan, PR A revue et fusionnée dans la branche pilote, vérification intégrée, puis le
même parcours pour PR B depuis le commit intégré de A. Le reviewer global indépendant relit
PRD/TAD, parent, deux preuves et sortie du check avant bilan et statuts Linear terminaux.

Conserver : versions/SHAs des deux packages installés, IDs des objets Linear/Paperclip,
empreinte source, mandat, enveloppe et réservations, runs/acteurs, URLs et têtes exactes des
deux PR, commits fusionnés, sortie du check, commentaires/statuts avec readback, verdict et
preuve terminale. A01 n’est réussi que si aucun effet pertinent ne reste inconnu. A02–A08
réutilisent les preuves L1–L5 ; aucun rejeu fournisseur général n’est prévu.

Arrêt immédiat avant l’effet dépendant si L5 n’est pas qualifié, si le gateway réel est
incomplet, si le dépôt est occupé, si la source change, si une publication est inconnue, si
la base avance, si le budget n’est plus admissible ou si une fusion/readback échoue. Pause,
reprise et annulation passent uniquement par les commandes Council prévues et conservent les
identités, consommations et intentions originales.

## Effets exacts à soumettre à approbation après L5

- créer le worktree/branche privée, pousser une seule branche pilote, créer deux PR vers elle,
  publier leurs readbacks et autoriser au plus une fusion de chacune ; aucun droit vers `main` ;
- créer un projet Paperclip isolé, ses sept acteurs bornés (`lead`, A, B, produit, qualité,
  reviewer Council indépendant, publisher), son mandat de chemins et l’occupation du dépôt ;
- installer les deux packages candidats qualifiés, puis activer uniquement cette société,
  ce nouveau projet Paperclip, le projet/équipe Hitza et les quatre tickets du pilote ;
- créer la milestone et les quatre tickets Linear ci-dessus, leurs parenté/dépendance initiales,
  puis autoriser au plugin seulement commentaires et statuts des objets gérés ;
- configurer la connexion `8a672ba5-d93c-41e6-a196-78147924cf6c` seulement après readback,
  le profil lecture `9f222f37-9e0c-46e6-9030-5ba33c879820`, deux clients/gateways distincts
  reader et publisher, chacun avec sa référence native de secret ; ne pas réutiliser le client expiré ;
- créer et qualifier séparément un profil publisher à privilèges minimaux ; son existence,
  ses schémas, sa portée commentaires/statuts et son readback sont encore non vérifiés ;
- autoriser explicitement la consommation du pilote dans une période native identifiée,
  après lecture du solde, des réservations et des autres mandats. Ne pas remplacer ni remettre
  à zéro le profil partagé de la société pour isoler artificiellement ce pilote.

Une unité vaut un token natif observé : `inputTokens + outputTokens`; `cachedInputTokens` est
déjà inclus dans l’entrée et n’est pas ajouté deux fois. Les réservations retiennent une
exposition, sans garantir un coût fournisseur maximal. La proposition initiale de 12 M par période / 2 M par run n'est pas retenue comme
configuration : `n1OperatingProfile` est partagé entre tous les mandats de la société.
Lecture du 9 octobre 2026 à 14:51 UTC : période
`content-assistant-closure-843798ae-d791-4052-8913-272d0088e289`, du
`2026-10-09T13:33:32.654Z` au `2026-10-09T21:33:32.654Z`, enveloppe 44 M,
réservation 4 M par run, consommation connue 14 490 953, sept réservations existantes.
Cette observation n'autorise pas à consommer le budget d'une autre mission. Le solde
admissible et l'absence d'occupation doivent être relus avant l'autorisation finale.

G4 retient l'exposition avant chaque nouveau run, puis règle la consommation observée
à sa fin. Un run peut dépasser sa réservation : ce mécanisme ne garantit pas un plafond
monétaire ou un plafond absolu de tokens. Aucun retry ni cycle de correction fournisseur
supplémentaire n'est inclus. L'autorisation finale fixe période, nombre prévisionnel de
runs issu de L5 et profils réellement disponibles. Une consommation insuffisamment connue
suspend le départ suivant.

Le scénario nominal isolé a réussi avec 17 runs : huit par livraison (préparation,
contribution, intégration, deux avis spécialisés, verdict, publication, fusion)
puis une revue globale. Ses 2 550 unités de fixture ne sont pas une estimation de
consommation réelle. La preuve terminale L5 confirme ce compte pour le scénario
nominal, sans autoriser de correction ou de reprise additionnelle.

Le même relevé voit Council `0.7.26` et intake `0.1.4` installés, sans run actif parmi les
207 runs renvoyés. Une mise à niveau recharge le plugin de l'instance, pas seulement le
nouveau projet : vérifier les autres mandats et obtenir l'autorisation de cette mise à
niveau avant effet. Ce relevé temporaire n'est pas une garantie de disponibilité future.

## Inconnues qui changent les effets

Complément d'inventaire du **9 octobre 2026, 21:45–21:46 UTC**, par GET Paperclip
uniquement : Council `0.7.26` et intake `0.1.4` restent installés ; intake est
désactivé et aucun run actif n'est observé dans la société cible. La période
partagée citée plus haut est terminée. Ces observations ne réservent ni fenêtre
de mise à niveau ni budget et ne garantissent pas l'absence d'activité ailleurs.

Le profil lecteur prévu existe, mais le gateway historique configuré utilise un
autre profil, sans les lectures milestone/commentaires nécessaires, et son client
de qualification est expiré. Aucun publisher Linear distinct à privilèges
minimaux n'a été identifié. La configuration installée ne porte ni enrollment
campagne, ni lecteur de source, ni publisher. Le catalogue stocké a été inspecté
sans appel gateway : il ne vaut pas Q-LR ou Q-LW. La mise en service exige donc,
outre HTTPS, la mise à niveau autorisée des plugins, les deux accès réellement
qualifiés, le mandat, les acteurs et le budget du pilote.

La paire corrigée qualifiée en isolation est Council `0.7.41` au commit
`60905259ef43af2edbafd2d2588abd991dd60db0` et intake `0.6.1` au commit
`3bae49255651fddc37e0c66b016ea73e8940d660`, aux empreintes du reçu lié en tête.
Les reçus L5 antérieurs de Council `0.7.31` / intake `0.6.0` sont conservés.
Restent à relever en lecture seule avant mise à niveau : versions
réellement installées, IDs du nouveau projet/milestone/
tickets/acteurs/états, références de secrets disponibles, schémas et pagination gateway réels,
droits du profil publisher, état de la connexion, disponibilité de la branche distante et
occupation Council. Les lectures gateway et les écritures commentaire/statut ont deux preuves
de capacité distinctes ; aucune n’est acquise ici.

Modèle conseillé pour les runs ordinaires et la revue finale : `gpt-5.6-sol`, effort `medium`,
à réévaluer vers `high` seulement sur ambiguïté substantielle. Source : mapping indépendant du
5 septembre 2026. Aucun réglage effectif n’est observé ; il reste hérité/inconnu jusqu’au readback
des profils et des runs.
