# PRD — Intégration Linear pour l'équipe de développement Paperclip

Version documentaire : 0.1 · 8 octobre 2026 · Europe/Paris.

**Statut : synthèse du cadrage produit décidé pendant le grill.** Ce document
décrit la cible. Il ne constitue ni un TAD, ni une preuve d'implémentation, ni une
autorisation d'activation, de fusion ou d'écriture sur des tickets réels.
Les choix techniques ouverts sont dans [TAD-QUESTIONS.md](TAD-QUESTIONS.md).

## 1. Vision et problème

Paperclip doit devenir le cœur autonome de l'équipe de développement. L'utilisateur
prépare dans Linear des objectifs structurés et engage leur réalisation. Paperclip
organise les agents, conduit le travail jusqu'à son intégration vérifiée et maintient
Linear à jour pendant tout le parcours.

**Linear est la source de vérité partagée du travail.** Un agent sans historique de
conversation doit pouvoir retrouver depuis Linear les informations nécessaires
pour travailler, vérifier une dépendance ou reprendre un chantier interrompu.
Une décision restée uniquement dans un chat, une mémoire d'agent ou un fichier local
inaccessible ne satisfait pas cette exigence.

Le besoin dépasse l'import initial et le changement de statut final : les agents
doivent partager un contexte actuel, des responsabilités explicites, des résultats
identifiables et les conditions de poursuite des chantiers liés. Un succès de run,
une PR créée ou un statut modifié ne prouve pas à lui seul la livraison attendue.

## 2. Utilisateurs, responsabilités et frontières

| Acteur ou composant | Responsabilité produit |
| --- | --- |
| Responsable humain | Valider le cadrage produit et le TAD, engager le périmètre, arbitrer les décisions réservées et les écarts structurants. |
| Agents de développement | Réaliser la conception détaillée, le code, les tests, la documentation et les corrections dans le cadre admis. Toute exécution passe par Paperclip. |
| Paperclip | Fournir le socle de l'équipe : identités, affectations, exécution, ressources, coordination et suivi opérationnel. Réutiliser les capacités natives avant d'ajouter du code. |
| Council | Porter les validations indépendantes et la conduite gouvernée du travail avec Paperclip. L'attribution technique précise du pilotage des campagnes reste à établir dans le TAD. |
| Intégration Linear | Lire et importer le contexte, détecter ses changements, publier les évolutions autorisées et réconcilier leurs effets. Elle ne décide pas seule d'admettre un travail ou de l'accepter. |
| Connexion Linear gérée par Paperclip | Fournir l'accès authentifié à Linear. Sa présence ne prouve ni droit d'écriture suffisant, ni synchronisation automatique. |

Le plugin d'intégration sera une **évolution de `paperclip-linear-intake` dans son
dépôt actuel**, distincte de Council. La lecture, le suivi des changements et la
publication relèvent de cette même responsabilité. Les tâches d'exécution, les
verdicts et les autorisations de fusion restent du côté Paperclip/Council.

Les runs, budgets et détails techniques peuvent rester dans Paperclip ; Git et les
artefacts conservent les résultats exacts. Linear doit en exposer les références
durables et toutes les informations utiles à la coordination. Le plan de travail
de référence doit être unique et accessible depuis Linear ; son emplacement
technique n'est pas décidé ici.

## 3. Décisions acquises

| ID | Décision |
| --- | --- |
| D01 | Paperclip est le point de passage de toute exécution. Un chat Codex externe peut aider à préparer, mais ne conduit pas un chantier concurrent hors de cette coordination. |
| D02 | Cadrage produit et TAD validés précèdent l'engagement. La conception détaillée est autonome ; les écarts structurants ou produit sont soumis à arbitrage. |
| D03 | Passer un ticket en `Todo` engage un chantier ponctuel sous l'autorité configurée. Engager une milestone entière exige un signal explicite distinct. |
| D04 | Les prérequis peuvent être pris en charge automatiquement seulement dans les milestones engagées et les tickets autorisés individuellement. |
| D05 | Une campagne de développement se termine après validation, fusion et vérification intégrée, ainsi que satisfaction des obligations propres des parents et de la milestone. Le déploiement reste distinct. |
| D06 | Chaque livraison reçoit un verdict Council indépendant des auteurs. Les spécialistes et la profondeur de revue sont proportionnés au besoin. |
| D07 | Le parallélisme est possible entre campagnes distinctes. Dans une campagne, chaque livraison est fusionnée et vérifiée avant l'implémentation de la suivante. |
| D08 | Un changement Linear entraîne une analyse d'impact et une réévaluation des travaux concernés ; les travaux indépendants continuent. |
| D09 | Pendant une indisponibilité Linear, les opérations locales déjà engagées peuvent s'achever. Nouveaux départs, fusions et clôtures attendent le rétablissement et la réconciliation. |
| D10 | Les arbitrages humains sont traités dans Paperclip. Question, décision et conséquences sont consignées dans Linear avant la reprise dépendante. |
| D11 | La hiérarchie, la granularité et le contrat de ticket reprennent les règles courantes de PEZ-524, PEZ-585, PEZ-282 et PEZ-528. |
| D12 | L'intégration Linear complète résulte de l'évolution de `linear-intake`, avec la connexion Linear gérée par Paperclip comme accès externe. |
| D13 | Le premier périmètre impose un dépôt par campagne. Plusieurs campagnes sur différents dépôts et leurs dépendances restent possibles. |
| D14 | Slack est hors périmètre ; son rôle ultérieur serait d'attirer l'attention sur les besoins, sans devenir une source concurrente de décision. |

La répartition services/repositories/controllers, les interfaces internes et le
découpage des fonctions relèvent par exemple de D02 lorsqu'ils respectent le TAD.
Un changement de stockage, de frontière de déploiement ou de contrat partagé
remettant en cause ce cadre nécessite une proposition d'évolution validée.

## 4. Contrat des tickets et des livraisons

La hiérarchie est **projet → milestone native → ticket → sous-ticket** selon le
résultat à représenter. Une milestone n'est pas un ticket parent artificiel.
Un ticket simple n'est pas automatiquement redécoupé. Le découpage déjà préparé
est consommé et complété seulement lorsqu'un besoin réel le justifie.

Les règles courantes de [PEZ-524](https://linear.app/pezzoslabs/issue/PEZ-524) et
[PEZ-585](https://linear.app/pezzoslabs/issue/PEZ-585) s'appliquent :

- Une feuille de livraison code porte sa propre PR, avec tests et documentation
  couplés. Un ticket code sans enfant porte directement cette PR.
- Chaque sous-ticket de livraison code possède sa PR complète ; le parent
  n'ajoute pas de PR redondante.
- Les microtâches techniques restent dans le plan. Une investigation ou une
  action humaine possède un résultat vérifiable, sans PR fictive.
- Les relations de dépendance traduisent un prérequis réel. Une parenté, une
  relation informative ou l'appartenance à une milestone ne devient pas
  automatiquement un blocage d'exécution.
- Une feuille code n'est terminée qu'après ses critères techniques, sa fusion
  authentifiée et sa vérification intégrée. Le parent attend également ses
  obligations propres et les résultats de ses enfants.

Le contrat de [PEZ-282](https://linear.app/pezzoslabs/issue/PEZ-282) fournit type,
acceptation identifiable, mode QA explicite et plan de vérification par critère :
preuve, commande ou scénario, résultat attendu et environnement. Les preuves
restent liées à la révision applicable. Les labels seuls ne valent ni autorisation
ni acceptation.

L'ancienne possibilité d'une PR commune à plusieurs sous-tickets de livraison
code n'est pas retenue : la décision courante de PEZ-524 l'a remplacée. Le ciblage
explicite de milestone prévu ici prévaut sur une résolution implicite de toute
la milestone à partir d'un simple ticket.

## 5. Périmètre du premier résultat utilisable

### Inclus

- Lecture complète du contexte autorisé : descriptions, hiérarchie, critères,
  exclusions, dépendances, décisions et références au cadrage/TAD applicables.
- Prise en charge d'un ticket ponctuel et d'une milestone explicitement engagée.
- Représentation native et correspondance durable entre le travail Linear et
  Paperclip, sans double prise en charge en cas de signaux qui se recouvrent.
- Suivi des changements après admission, pendant toute la campagne.
- Publication des responsabilités, étapes significatives, questions, décisions,
  blocages, résultats, PR, preuves et informations de reprise.
- Réconciliation après interruption, panne, événement dupliqué ou résultat
  d'écriture incertain, avec visibilité de l'état réel de synchronisation.
- Coordination des dépendances et parallélisme entre campagnes sous les règles
  d'exécution de Paperclip/Council.
- Clôture fondée sur les preuves et obligations propres, puis confirmation de
  sa représentation dans Linear.

### Exclus

- Nouvelle norme de tickets ou nouvelle hiérarchie concurrente de Workflow.
- Exécution autonome hors Paperclip, orchestration par l'importeur ou second
  ordonnanceur de développement dans le plugin Linear.
- Redéfinition autonome du produit ou des décisions structurantes du TAD.
- Engagement implicite d'une autre milestone ou de ses prérequis non autorisés.
- Implémentation parallèle des livraisons d'une même campagne et campagne
  couvrant plusieurs dépôts.
- Slack, publication en preview, QA de release et déploiement en production.
- Provisionnement de comptes, secrets ou ressources, migration historique
  globale, changement de règles GitHub ou activation opérationnelle par ce PRD.

Les sources Workflow décrivent un cycle de release après clôture d'une milestone
déployable. Ce cycle reste une responsabilité aval distincte du périmètre présent.
Le dossier de clôture conserve les obligations de QA encore applicables, sans
prétendre que la release est qualifiée ou déployée. Une milestone sans livraison
code se clôt sur ses propres preuves, sans imposer fusion ou release vide.

## 6. Parcours attendus

### J01 — Prendre en charge un ticket ponctuel

Un ticket passe en `Todo` dans le périmètre configuré. L'intégration récupère sa
source actuelle et les descendants nécessaires. La sélection d'un enfant ne
délègue pas ses frères ni tout son parent ; sélectionner un parent couvre son
sous-arbre restant. Paperclip vérifie contexte, cadre validé, autorité,
dépendances et capacité avant de commencer. Les résultats historiques terminés
ou annulés ne sont pas rejoués comme nouveau travail.

### J02 — Conduire une milestone engagée

L'utilisateur engage explicitement une milestone. Son périmètre, ses membres,
descendants et obligations propres sont établis complètement. Un plan de
référence organise les livraisons et les prérequis, sans doublonner les tickets.
Les inconnues et actions humaines découvrables sont préparées tôt ; les questions
indépendantes peuvent être regroupées. Paperclip poursuit les étapes couvertes
sans demander une relance à chaque ticket.

Une dépendance extérieure au périmètre engagé reste visible et attend son
autorisation ; elle n'empêche pas les autres travaux prêts. Entre campagnes, le
résultat exigé par chaque dépendance est identifiable et vérifié. Un état `Done`
isolé ne remplace pas la preuve attendue.

### J03 — Livrer et rendre le travail compréhensible

Les agents réalisent la conception détaillée et la livraison. Council apporte le
verdict indépendant. Après contrôles, fusion et vérification intégrée, les
preuves sont associées à la feuille correspondante et Linear est actualisé.
La livraison suivante peut alors commencer selon les dépendances et les limites.
Le parent et la milestone attendent aussi leurs critères propres.

Le suivi distingue au moins travail engagé, implémentation produite, revue,
correction, attente indispensable, intégration vérifiée et clôture. Ce sont des
significations métier à projeter sur les états disponibles ; le PRD n'impose pas
de nouveaux noms de statuts Linear. Une attente technique interne de Paperclip
ne doit pas être présentée automatiquement comme un blocage produit.

### J04 — Répondre à un changement ou à une décision humaine

Une modification de périmètre, de critère, de dépendance ou de référence est
détectée et rapprochée du contexte utilisé. Seuls les travaux et preuves affectés
sont réévalués. Une adaptation technique couverte peut être menée de façon
autonome ; un arbitrage réservé est présenté dans Paperclip, avec question,
responsable, options et condition de reprise. Sa réponse et ses conséquences
sont visibles depuis Linear avant la reprise dépendante.

### J05 — Reprendre sans perte de contexte ni double effet

Lors d'une panne Linear, les opérations locales déjà engagées peuvent finir dans
leurs limites existantes. Les nouveaux départs, fusions et clôtures sont retenus.
Au rétablissement, le système relit les sources et recherche les effets déjà
réalisés avant de poursuivre. Une réponse perdue ne déclenche ni double création,
ni commentaire répété, ni remplacement d'une identité incertaine.

Un agent nouvellement affecté retrouve depuis Linear le résultat obtenu, ce qui
reste à faire, la version applicable, les blocages et la prochaine action. Il n'a
pas besoin du chat précédent. Une pause ou annulation n'est jamais interprétée
comme une permission de reprise ou une réussite.

## 7. Exigences et signaux d'acceptation

| ID | Exigence vérifiable |
| --- | --- |
| R01 — Contexte autonome | Depuis le ticket et ses références accessibles, un nouvel agent retrouve objectif, périmètre/exclusions, critères et vérifications, TAD applicable, dépôt, responsabilités, dépendances, décisions, résultats et suite. Une information décisive manquante empêche les seuls travaux qui en dépendent. |
| R02 — Source complète | Une lecture tronquée, une pagination incomplète, une identité ambiguë ou un contexte changeant n'est jamais présenté comme un périmètre prêt. Les objets terminés et historiques conservent leur provenance. |
| R03 — Engagement borné | Ticket ponctuel et milestone ont une portée explicite. Les signaux répétés ou recouvrants ne créent pas de second chantier ; les membres ajoutés ensuite ne sont pas incorporés silencieusement. |
| R04 — Autonomie dans le cadre | Les décisions de conception détaillée restent compatibles avec produit/TAD. Les écarts structurants et décisions produit indispensables sont soumis au responsable, sans créer un ticket pour chaque microtâche. |
| R05 — Ordre et coordination | Les prérequis réels et résultats attendus gouvernent l'ordre. Une campagne reste sérielle ; les campagnes indépendantes peuvent progresser sans contourner les contrôles de conflit et de capacité. |
| R06 — Validation et livraison | Chaque feuille code possède sa PR et ses preuves. Une revue indépendante, les contrôles applicables, la fusion et la vérification intégrée précèdent sa clôture et la livraison suivante. |
| R07 — Actualisation utile | Chaque étape significative, changement de responsabilité, blocage, décision, résultat et reprise est représenté dans Linear. Le suivi ne produit pas un commentaire à chaque sous-étape technique. |
| R08 — Décisions traçables | Informations sans réponse attendue, actions humaines préparées et exceptions sont distinguées. Une décision possède auteur, contexte applicable, conséquences et événement de reprise ; sa consignation Linear est vérifiée. |
| R09 — Changements maîtrisés | Ajout/retrait de membre, changement de critère et modification de dépendance déclenchent une analyse d'impact. Une preuve périmée ne valide pas une nouvelle révision ; les résultats indépendants encore valides sont conservés. |
| R10 — Synchronisation observable | Le suivi distingue résultat du travail et confirmation de sa publication Linear. Un effet inconnu reste visible et est réconcilié sous son identité d'origine ; ni perte silencieuse ni succès supposé. |
| R11 — Panne et reprise | Une indisponibilité Linear retient nouveaux départs, fusions et clôtures. La reprise requiert source actuelle et effets réconciliés ; les limites initiales et l'historique sont conservés. |
| R12 — Clôture complète | Enfants nécessaires, obligations propres des parents et critères communs de milestone sont prouvés. La clôture n'est pas déduite d'un pourcentage, d'un run réussi ou de la seule dernière fusion. |
| R13 — Frontières d'effet | Aucun secret dans Linear ou les preuves ; aucune permission nouvelle déduite d'un événement. Les écritures restent dans le projet, les objets et les champs autorisés, sans écrasement silencieux d'un changement humain concurrent. |
| R14 — Continuité de l'existant | Les correspondances et preuves historiques restent traçables pendant l'évolution du plugin. L'installation d'une version n'active pas implicitement l'écriture ou les campagnes anciennes. |

Les signaux de succès sont observables : un agent neuf reprend sans transmission
orale, une campagne engagée avance sans relance entre tickets, les sollicitations
humaines concernent les seuls besoins réels, et Linear permet de comprendre les
responsabilités et la prochaine action. Mesurer aussi les prérequis découverts
tardivement, le délai de consignation/reprise et les divergences non résolues.
Aucune cible chiffrée de délai ou de coût n'a été décidée pendant ce grill.

## 8. Surfaces et lisibilité

L'utilisateur suit les tickets, décisions et preuves depuis Linear et traite les
arbitrages depuis Paperclip. Réutiliser les surfaces natives pertinentes ; ce PRD
ne prescrit pas une nouvelle console ou un système de design.

Pour chaque attente, le suivi indique la cause, le responsable, le travail encore
possible et la condition de reprise. Pour chaque résultat, il expose le ticket,
la PR ou l'artefact exact et la preuve utile. Les références doivent être durables
et accessibles aux acteurs autorisés ; un chemin local isolé ne suffit pas.

Les détails des écrans, des notifications, de l'accessibilité et des langues sont
à vérifier au cadrage technique des surfaces réellement retenues. Aucun nouveau
canal de notification externe n'est inclus.

## 9. Validation attendue du produit

| Scénario | Observation attendue | Couverture |
| --- | --- | --- |
| V01 — Agent sans contexte | Reprise depuis Linear et références autorisées, sans chat antérieur ni décision devinée. | R01, R07, R08 |
| V02 — Ticket seul, parent et enfant sélectionné | Portée exacte, histoire préservée, aucun élargissement à la milestone ou aux frères. | R02, R03, R14 |
| V03 — Milestone avec plusieurs livraisons | PR par feuille, progression sérielle, parents et critères communs vérifiés avant clôture. | R04, R06, R12 |
| V04 — Campagnes indépendantes et dépendantes | Parallélisme permis seulement sur les travaux prêts ; dépendance extérieure signalée sans engagement implicite. | R03, R05 |
| V05 — Source modifiée en cours de travail | Analyse d'impact, réévaluation ciblée, conservation des résultats indépendants et refus d'une preuve périmée. | R02, R09 |
| V06 — Arbitrage humain | Question dans Paperclip, réponse et conséquences consignées dans Linear, reprise du bon travail après confirmation. | R07, R08 |
| V07 — Panne et réponse perdue | Pas de nouveau départ/fusion/clôture hors synchronisation ; recherche des effets existants et reprise sans doublon. | R10, R11 |
| V08 — Événements répétés ou désordonnés | Une prise en charge unique, aucun retour à un ancien état sous l'effet d'une notification tardive. | R03, R10 |
| V09 — Revue refusée ou contrôle échoué | Correction dans les limites admises, nouvelle preuve sur le résultat corrigé, aucune fusion prématurée. | R04, R06 |
| V10 — Clôture trompeuse | Parent incomplet, critère commun restant ou synchronisation inconnue ne produit pas de faux succès. | R10, R12 |
| V11 — Champ ou acteur hors autorité | Effet refusé et cause visible, sans changement étranger ni divulgation de secret. | R13 |
| V12 — Mise à niveau, pause et annulation | Histoire conservée, aucun ancien ticket réengagé implicitement et aucune reprise non autorisée. | R03, R11, R14 |

Les tests déterministes établissent les règles et refus. Une qualification native
bornée doit ensuite distinguer effets Paperclip, écriture/relecture Linear,
exécution des agents et fusion Git réelles. Un humain juge la lisibilité du suivi
et la pertinence des sollicitations sur un parcours représentatif ; ce jugement
de validation du produit ne réintroduit pas une approbation humaine de chaque PR.
Les documents Workflow ne prouvent pas ces capacités dans Paperclip.

## 10. État observé et écarts vers la cible

Base de rédaction relue le 8 octobre 2026 :

- Intégration : `origin/main` à `6da9d8741f28c4d6a2d7a9bedc7daa82df7ff465`,
  manifeste `0.4.0` ; la branche distante a été vérifiée.
- Council : `origin/main` à `caae28707b63496e5ae26addab2c5914d2028738`,
  identité distante vérifiée ; cela ne constitue pas un audit complet de cette
  version ou de son installation.
- Aucune inspection ou modification de l'instance opérationnelle par ce lot
  documentaire ; aucun test métier ou effet externe revendiqué.

Le dépôt contient déjà lecture de familles, rétention des demandes, import natif,
journaux d'effets et contrat de revalidation avant admission Council. Les
qualifications publiées distinguent lecture native et parcours isolé avec
transports Linear/modèle déterministes, arrêté avant N2.

Le [contrat actuel](TODO-INTAKE-CONTRACT.md) porte sur Todo et le sous-arbre
sélectionné. Il exclut l'écriture retour Linear. Le
[handoff actuel](COUNCIL-HANDOFF-V1.md) ne révoque pas automatiquement une mission
après un changement Linear ultérieur ; le receveur décrit requiert un descendant
exécutable et refuse les références de blocage externes. La cible ajoute donc
des capacités substantielles : ticket sans enfant, milestone complète, échanges
continus, dépendances entre campagnes et publication vérifiée.

Les contrats et preuves actuels restent les références de leur périmètre livré.
Le présent PRD ne les réécrit pas rétroactivement. Le TAD devra expliquer les
évolutions et leur compatibilité avant qu'un lot d'implémentation soit défini.

## 11. Sources, préséance et questions restantes

Ordre de préséance pour cette cible : décisions explicites du grill et demande de
rédaction du 8 octobre 2026 ; décisions courantes des tickets Linear référencés ;
sources et preuves du dépôt pour l'état existant. Les sections historiques des
tickets ne rétablissent pas une règle explicitement remplacée. Les anciens
acteurs/outils de Workflow ne sont pas imposés à Paperclip par leur mention.

| Source relue dans Linear le 8 octobre 2026 | Révision observée (`updatedAt`, UTC) | Utilisation |
| --- | --- | --- |
| [PEZ-524](https://linear.app/pezzoslabs/issue/PEZ-524) | 2026-10-06T15:26:46.894Z | Hiérarchie, unités de PR, préparation, campagne sérielle, reprise et obligations de clôture. |
| [PEZ-585](https://linear.app/pezzoslabs/issue/PEZ-585) | 2026-09-28T23:46:02.712Z | Milestone native, features et contributions, identités et publication vérifiée. |
| [PEZ-282](https://linear.app/pezzoslabs/issue/PEZ-282) | 2026-09-18T12:48:13.637Z | Contrat de ticket, QA et vérification par critère. |
| [PEZ-528](https://linear.app/pezzoslabs/issue/PEZ-528) | 2026-09-27T20:54:45.034Z | Conditions de Done, obligations des parents et séparation intégration/QA de release/production. |

Références locales : [architecture actuelle](ARCHITECTURE.md),
[séquence et limites de qualification](IMPLEMENTATION-PLAN.md),
[qualification du receveur](qualification/COUNCIL-RECEIVER.md).
Les quatre descriptions Linear étaient inchangées entre leur lecture pendant
le grill et la relecture de rédaction. Leur contenu peut évoluer ultérieurement.

Restent ouverts : répartition précise des capacités natives et du code Council,
contrats d'échange, stockage et versions du contexte, correspondance des états,
autorité par champ, permissions d'écriture, détection et ordre des changements,
gestion des conflits, mécanisme d'engagement, mise à niveau et preuves natives.
Ce sont les questions de [TAD-QUESTIONS.md](TAD-QUESTIONS.md), sans architecture
technique choisie ni autorisation d'implémentation implicite.
