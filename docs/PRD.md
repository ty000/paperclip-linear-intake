# PRD — Intégration Linear pour l'équipe de développement Paperclip

Version documentaire : 0.2 · 9 octobre 2026 · Europe/Paris.

**Statut : synthèse du cadrage produit décidé pendant le grill.** Ce document
décrit la cible. Il ne constitue ni un TAD, ni une preuve d'implémentation, ni une
autorisation d'activation, de fusion ou d'écriture sur des tickets réels.
Les choix techniques ouverts sont dans [TAD-QUESTIONS.md](TAD-QUESTIONS.md).
Cette révision intègre les sept arbitrages d'autonomie confirmés le 9 octobre
2026 (D15–D21) et leurs critères de validation.

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
| D02 | Cadrage produit et TAD validés précèdent l'engagement. La conception détaillée est autonome ; un nouveau résultat produit ou un écart au cadre produit/TAD validé est soumis à arbitrage. |
| D03 | Passer un ticket en `Todo` engage un chantier ponctuel sous l'autorité configurée. Engager une milestone entière exige un signal explicite distinct. |
| D04 | Les prérequis peuvent être pris en charge automatiquement seulement dans le périmètre des milestones engagées et des tickets autorisés individuellement. D19 permet de compléter leur découpage technique, sans engager une autre milestone. |
| D05 | Une campagne de développement est achevée avec succès après validation, fusion et vérification intégrée, ainsi que satisfaction des obligations propres des parents et de la milestone. Le déploiement reste distinct. |
| D06 | Chaque livraison reçoit un verdict Council indépendant des auteurs. Les spécialistes et la profondeur de revue sont proportionnés au besoin. |
| D07 | Le parallélisme est possible entre campagnes distinctes. Dans une campagne, chaque livraison est fusionnée et vérifiée avant l'implémentation de la suivante. |
| D08 | Un changement Linear entraîne une analyse d'impact et une réévaluation des travaux concernés ; les travaux indépendants continuent. |
| D09 | Pendant une indisponibilité Linear, les opérations locales déjà engagées peuvent s'achever. Nouveaux départs, fusions et clôtures attendent le rétablissement et la réconciliation. |
| D10 | Les arbitrages humains sont traités dans Paperclip. Question, décision et conséquences sont consignées dans Linear avant la reprise dépendante. |
| D11 | La hiérarchie, la granularité et le contrat de ticket reprennent les règles courantes de PEZ-524, PEZ-585, PEZ-282 et PEZ-528. |
| D12 | L'intégration Linear complète résulte de l'évolution de `linear-intake`, avec la connexion Linear gérée par Paperclip comme accès externe. |
| D13 | Le premier périmètre impose un dépôt par campagne. Plusieurs campagnes sur différents dépôts et leurs dépendances restent possibles. |
| D14 | Slack est hors périmètre ; son rôle ultérieur serait d'attirer l'attention sur les besoins, sans devenir une source concurrente de décision. |
| D15 | Une modification Linear par un acteur habilité autorise l'adaptation automatique du travail après analyse d'impact et réévaluation des preuves, tant qu'elle reste compatible avec le cadre produit, le TAD et les limites autorisées. Un dépassement ou une autorité non établie requiert un arbitrage avant la poursuite dépendante. |
| D16 | Pour le travail pris en charge, Paperclip corrige automatiquement un statut de progression Linear contraire aux preuves et en consigne la raison. Un `Done` manuel ne vaut pas livraison ; pause et annulation restent des commandes distinctes à respecter. |
| D17 | Une pause arrête le travail au prochain point sûr : l'opération en cours peut se terminer pour préserver un état récupérable, mais aucun nouveau travail ni nouvelle fusion ne démarre. Les résultats sont conservés ; la reprise est explicite et précédée d'une revalidation. Un effet déjà envoyé reste à réconcilier. |
| D18 | Lorsqu'une milestone est engagée après l'un de ses tickets, le ticket rejoint sa campagne comme livraison courante. Travail, identités, preuves, historique et budget consommé sont conservés sans double départ ni remise à zéro ; les livraisons suivantes restent sérielles. |
| D19 | Paperclip peut créer dans Linear et engager une livraison technique nécessaire aux critères déjà autorisés, avec justification, plan et dépendances actualisés. Un nouveau résultat produit ou un dépassement du cadre produit/TAD ou des limites autorisées exige un accord humain ; les microtâches restent dans le plan. |
| D20 | Après un échec de vérification intégrée, Paperclip peut choisir et conduire une correction ou une PR de retour arrière dans son autorité existante. Chaque nouvelle PR reçoit contrôles, revue indépendante et vérification intégrée ; les conséquences incertaines ou un dépassement nécessitent un arbitrage. |
| D21 | Annuler une campagne arrête le travail restant au prochain point sûr, ferme les PR non fusionnées devenues sans objet et conserve leurs commits. Les livraisons déjà intégrées restent en place ; travail livré et annulé sont distingués, sans présenter la campagne comme une réussite. Leur retrait relève d'une demande distincte. |

La répartition services/repositories/controllers, les interfaces internes et le
découpage des fonctions relèvent par exemple de D02 lorsqu'ils respectent le TAD.
Un changement de stockage, de frontière de déploiement ou de contrat partagé
remettant en cause ce cadre nécessite une proposition d'évolution validée.

## 4. Contrat des tickets et des livraisons

La hiérarchie est **projet → milestone native → ticket → sous-ticket** selon le
résultat à représenter. Une milestone n'est pas un ticket parent artificiel.
Un ticket simple n'est pas automatiquement redécoupé. Le découpage déjà préparé
est consommé et complété seulement lorsqu'un besoin réel le justifie.

Un prérequis technique découvert peut devenir un nouveau ticket de livraison
dans le périmètre engagé s'il sert strictement les critères déjà autorisés et
respecte le cadre produit, le TAD et le budget. Paperclip explique sa nécessité
dans Linear, actualise le plan et les dépendances, puis le prend en charge sans
nouvelle confirmation. La simple présence d'un nouveau membre dans une milestone
ne suffit pas à établir ces conditions. Un élargissement du résultat attendu ou
des limites reste soumis à accord humain.

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

Une correction ou un retour arrière après fusion possède sa propre PR, reliée
à la livraison concernée et à l'échec constaté. L'exigence d'une PR par feuille
n'interdit pas ces PR de rétablissement ; elle interdit une PR commune à plusieurs
feuilles de livraison code. Toutes les révisions et preuves
restent identifiables.

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
- Adaptation autorisée, correction expliquée des statuts, rattachement à une
  milestone et création de prérequis techniques selon D15–D19.
- Pause, reprise explicite, rétablissement après échec d'intégration et annulation
  du travail restant selon D17, D20 et D21.
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

Si un ticket de la milestone a déjà démarré individuellement, il rejoint cette
campagne comme livraison courante. Le rattachement conserve son travail, ses
identités, ses preuves et son historique, ainsi que le budget déjà consommé.
Il ne crée pas de seconde exécution, ne remet pas les compteurs à zéro et
n'augmente pas à lui seul les limites autorisées. Les autres livraisons suivent
ensuite la séquence de la milestone et les dépendances.

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

Pour un travail pris en charge, si un statut de progression saisi dans Linear
contredit les preuves, Paperclip rétablit le statut correspondant au travail
réel et consigne la raison dans Linear. Par exemple, un `Done` manuel alors que
la PR n'est pas fusionnée est corrigé ; il ne libère ni clôture ni dépendance.
Le chantier poursuit son cours sous les contrôles habituels. Une pause ou une
annulation explicite n'est pas corrigée comme une erreur de progression ; elle
déclenche le parcours d'arrêt correspondant.

### J04 — Répondre à un changement ou à une décision humaine

Une modification de périmètre, de critère, de dépendance ou de référence est
détectée et rapprochée du contexte utilisé. Seuls les travaux et preuves affectés
sont réévalués. Si l'auteur est habilité et que la modification reste compatible
avec le cadre produit, le TAD et les limites autorisées, Paperclip adapte le plan
et poursuit sans demander une seconde confirmation. Cela couvre l'ajout d'un
critère compatible avec ce cadre, même s'il augmente le travail dans le budget
autorisé. Les résultats indépendants encore valides sont conservés.

Une autorité non établie, un dépassement ou un arbitrage réservé est présenté
dans Paperclip, avec question, responsable, options et condition de reprise.
La réponse et ses conséquences sont visibles depuis Linear avant la reprise
dépendante ; les travaux indépendants continuent dans leur cadre existant.

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

### J06 — Mettre en pause et reprendre explicitement

Une pause interdit immédiatement tout nouveau travail et toute nouvelle fusion.
L'opération déjà en cours peut atteindre le prochain point sûr afin de conserver
un état récupérable ; elle ne justifie pas de terminer toute la livraison.
Paperclip conserve résultats, limites, responsabilités et prochaine action.
Une fusion déjà envoyée est réconciliée sous son identité d'origine, sans
promettre son annulation. La reprise exige une demande explicite et la
revalidation du contexte, des preuves, de l'autorité et des effets en suspens.

### J07 — Rétablir après un échec de vérification intégrée

Une fusion suivie d'une vérification intégrée en échec laisse la livraison
incomplète et bloque le départ de la suivante. Paperclip diagnostique puis
choisit une correction ou une PR de retour arrière si les conséquences sont
établies et restent dans son autorité et son budget. Cette PR passe par les
contrôles applicables, le verdict Council indépendant, la fusion autorisée et
une nouvelle vérification intégrée. Une conséquence incertaine ou un dépassement
du cadre nécessite un arbitrage humain.

L'échec, les PR successives et leurs preuves restent visibles dans Linear.
Rétablir la branche par un retour arrière ne satisfait pas à lui seul les
critères de la livraison concernée : sa clôture et le départ de la
livraison suivante restent soumis aux obligations applicables.

### J08 — Annuler le travail restant

L'annulation applique l'arrêt au prochain point sûr et interdit de nouveaux
départs ou fusions de livraison. Après réconciliation des effets en cours,
Paperclip ferme les PR non fusionnées devenues sans objet et conserve leurs
commits et l'historique. Les livraisons déjà intégrées restent en place. Linear
présente distinctement les résultats livrés et le travail annulé ; la campagne
n'est pas déclarée achevée avec succès. Retirer des résultats déjà intégrés
requiert une demande distincte tenant compte des dépendances concernées.

## 7. Exigences et signaux d'acceptation

| ID | Exigence vérifiable |
| --- | --- |
| R01 — Contexte autonome | Depuis le ticket et ses références accessibles, un nouvel agent retrouve objectif, périmètre/exclusions, critères et vérifications, TAD applicable, dépôt, responsabilités, dépendances, décisions, résultats et suite. Une information décisive manquante empêche les seuls travaux qui en dépendent. |
| R02 — Source complète | Une lecture tronquée, une pagination incomplète, une identité ambiguë ou un contexte changeant n'est jamais présenté comme un périmètre prêt. Les objets terminés et historiques conservent leur provenance. |
| R03 — Engagement borné | Ticket ponctuel et milestone ont une portée explicite. Les signaux répétés ou recouvrants ne créent pas de second chantier. Un ticket déjà lancé rejoint la milestone ensuite engagée sans perte d'identité ni remise à zéro du budget consommé. Les membres ajoutés ensuite ne sont pas incorporés silencieusement ; leur prise en charge respecte R04 et R09. |
| R04 — Autonomie dans le cadre | Paperclip peut créer et engager un ticket de livraison technique nécessaire aux critères déjà autorisés, avec justification dans Linear et actualisation du plan et des dépendances. Produit, TAD et limites restent respectés ; un nouveau résultat produit ou un dépassement exige un accord humain. Les microtâches restent dans le plan. |
| R05 — Ordre et coordination | Les prérequis réels et résultats attendus gouvernent l'ordre. Une campagne reste sérielle ; les campagnes indépendantes peuvent progresser sans contourner les contrôles de conflit et de capacité. |
| R06 — Validation et livraison | Chaque feuille code possède sa PR et ses preuves. Une revue indépendante, les contrôles applicables, la fusion et la vérification intégrée précèdent sa clôture et la livraison suivante. |
| R07 — Actualisation utile | Chaque étape significative, changement de responsabilité, blocage, décision, résultat et reprise est représenté dans Linear. Un statut de progression incohérent avec les preuves est corrigé automatiquement avec explication, sans neutraliser une pause ou annulation. Le suivi ne produit pas un commentaire à chaque sous-étape technique. |
| R08 — Décisions traçables | Informations sans réponse attendue, actions humaines préparées et exceptions sont distinguées. Une décision possède auteur, contexte applicable, conséquences et événement de reprise ; sa consignation Linear est vérifiée. |
| R09 — Changements maîtrisés | Ajout/retrait de membre, changement de critère et modification de dépendance déclenchent une analyse d'impact. Une modification par un acteur habilité, compatible avec produit/TAD et limites, autorise adaptation et poursuite sans seconde confirmation ; sinon la poursuite dépendante attend l'arbitrage. Une preuve périmée ne valide pas une nouvelle révision ; les résultats indépendants encore valides sont conservés. |
| R10 — Synchronisation observable | Le suivi distingue résultat du travail et confirmation de sa publication Linear. Un effet inconnu reste visible et est réconcilié sous son identité d'origine ; ni perte silencieuse ni succès supposé. |
| R11 — Panne et reprise | Une indisponibilité Linear retient nouveaux départs, fusions et clôtures. La reprise requiert source actuelle et effets réconciliés ; les limites initiales et l'historique sont conservés. |
| R12 — Clôture complète | Enfants nécessaires, obligations propres des parents et critères communs de milestone sont prouvés. La clôture n'est pas déduite d'un pourcentage, d'un run réussi ou de la seule dernière fusion. |
| R13 — Frontières d'effet | Aucun secret dans Linear ou les preuves ; aucune permission nouvelle déduite d'un événement. Les écritures restent dans le projet, les objets et les champs autorisés, sans écrasement silencieux d'un changement humain concurrent. |
| R14 — Continuité de l'existant | Les correspondances et preuves historiques restent traçables pendant l'évolution du plugin. L'installation d'une version n'active pas implicitement l'écriture ou les campagnes anciennes. |
| R15 — Pause maîtrisée | Aucun nouveau travail ni nouvelle fusion après la pause ; seule l'opération en cours peut atteindre un point sûr. Résultats et effets déjà envoyés sont conservés et réconciliés. La reprise est explicite et précédée d'une revalidation. |
| R16 — Rétablissement contrôlé | Un échec après fusion bloque la livraison suivante. Correction ou PR de retour arrière sont autonomes dans le cadre autorisé lorsque leurs conséquences sont établies ; chaque PR reçoit revue indépendante, contrôles et vérification intégrée. Incertitude ou dépassement requièrent arbitrage ; l'échec et les obligations restantes demeurent visibles. |
| R17 — Annulation sans faux succès | L'annulation arrête le travail restant au prochain point sûr, réconcilie les effets en cours, ferme les PR non fusionnées devenues sans objet et conserve leurs commits. Les résultats déjà intégrés restent en place et sont distingués du travail annulé ; aucun succès global ni reprise implicite n'en est déduit. |

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
| V05 — Source modifiée en cours de travail | Un critère ajouté par un acteur habilité dans le cadre produit/TAD et le budget entraîne adaptation et poursuite sans seconde confirmation. Un dépassement ou une autorité non établie attend l'arbitrage ; les travaux indépendants continuent et une preuve périmée reste refusée. | R02, R09, R13 |
| V06 — Arbitrage humain | Question dans Paperclip, réponse et conséquences consignées dans Linear, reprise du bon travail après confirmation. | R07, R08 |
| V07 — Panne et réponse perdue | Pas de nouveau départ/fusion/clôture hors synchronisation ; recherche des effets existants et reprise sans doublon. | R10, R11 |
| V08 — Événements répétés ou désordonnés | Une prise en charge unique, aucun retour à un ancien état sous l'effet d'une notification tardive. | R03, R10 |
| V09 — Revue refusée ou contrôle échoué | Correction dans les limites admises, nouvelle preuve sur le résultat corrigé, aucune fusion prématurée. | R04, R06 |
| V10 — Clôture trompeuse | Parent incomplet, critère commun restant ou synchronisation inconnue ne produit pas de faux succès. | R10, R12 |
| V11 — Champ ou acteur hors autorité | Effet refusé et cause visible, sans changement étranger ni divulgation de secret. | R13 |
| V12 — Mise à niveau | Histoire conservée, aucun ancien ticket réengagé implicitement et aucune capacité activée sans autorisation. | R03, R14 |
| V13 — Statut manuel contraire aux preuves | Un `Done` sans fusion et vérification intégrée est corrigé et expliqué dans Linear ; il ne libère aucun travail à tort. Une pause ou annulation explicite reste respectée. | R06, R07, R13, R15, R17 |
| V14 — Milestone engagée après un ticket | Le ticket en cours rejoint la campagne avec travail, identités, preuves, historique et budget consommé conservés ; aucune seconde exécution, puis progression sérielle. | R03, R05, R10 |
| V15 — Prérequis technique découvert | Un prérequis strictement nécessaire aux critères engagés est créé, expliqué, relié et pris en charge dans les limites autorisées. Nouveau résultat produit ou dépassement attendent un accord ; une microtâche reste dans le plan. | R03, R04, R09, R13 |
| V16 — Pause pendant une opération ou une fusion envoyée | Aucun nouveau départ ni nouvelle fusion ; état récupérable au prochain point sûr, effet envoyé réconcilié sans supposer son annulation. La reprise exige une demande explicite et une revalidation. | R10, R15 |
| V17 — Échec après fusion | La livraison suivante reste bloquée. Correction ou retour arrière dans les limites passent par une nouvelle PR, revue et vérification ; conséquences incertaines ou dépassement attendent arbitrage. Un retour arrière ne suffit pas à déclarer la livraison réussie. | R06, R08, R16 |
| V18 — Annulation après des livraisons intégrées | Les livraisons intégrées restent en place, les PR non fusionnées devenues sans objet sont fermées après réconciliation et leurs commits conservés. Le reste est annulé sans succès global ; retirer le code intégré exige une demande distincte. | R10, R12, R17 |

Les tests déterministes établissent les règles et refus. Une qualification native
bornée doit ensuite distinguer effets Paperclip, écriture/relecture Linear,
exécution des agents et fusion Git réelles. Un humain juge la lisibilité du suivi
et la pertinence des sollicitations sur un parcours représentatif ; ce jugement
de validation du produit ne réintroduit pas une approbation humaine de chaque PR.
Les documents Workflow ne prouvent pas ces capacités dans Paperclip.

## 10. État observé et écarts vers la cible

Base de rédaction relue le 8 octobre 2026, conservée comme observation historique
pour cette révision documentaire :

- Intégration : `origin/main` à `6da9d8741f28c4d6a2d7a9bedc7daa82df7ff465`,
  manifeste `0.4.0` ; la branche distante a été vérifiée.
- Council : `origin/main` à `caae28707b63496e5ae26addab2c5914d2028738`,
  identité distante vérifiée ; cela ne constitue pas un audit complet de cette
  version ou de son installation.
- Aucune inspection ou modification de l'instance opérationnelle par ce lot
  documentaire ; aucun test métier ni effet d'intégration opérationnel revendiqué.

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

Ordre de préséance pour cette cible : sept arbitrages explicites du 9 octobre
2026 (D15–D21), puis cadrage et demande de rédaction du 8 octobre 2026 ; décisions
courantes des tickets Linear référencés ; sources et preuves du dépôt pour l'état
existant. Les sections historiques des tickets ne rétablissent pas une règle
explicitement remplacée. Les anciens acteurs/outils de Workflow ne sont pas
imposés à Paperclip par leur mention.

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
le grill initial et la relecture de rédaction du 8 octobre. Elles n'ont pas été
relues dans Linear pour la révision du 9 octobre ; leur contenu peut évoluer.

La révision 0.2 part de `origin/main` à
`cfb6297fcff05664506c4393b56b80b8c268f567`, qui contient le PRD 0.1 fusionné.
Sa source nouvelle est la confirmation humaine des sept comportements décrits
par D15–D21. Cette mise à jour ne requalifie ni le runtime ni les preuves du §10.

Restent ouverts : répartition précise des capacités natives et du code Council,
contrats d'échange, stockage et versions du contexte, correspondance des états,
contrôles d'autorité par champ, permissions d'écriture, détection et ordre des
changements, gestion des conflits, mécanisme d'engagement, rattachement sans
double exécution, points sûrs d'arrêt, mise à niveau et preuves natives.
Ces mécanismes doivent appliquer D15–D21 ; les sept comportements produit ne
sont plus des choix ouverts à redécider dans le TAD.
Ce sont les questions de [TAD-QUESTIONS.md](TAD-QUESTIONS.md), sans architecture
technique choisie ni autorisation d'implémentation implicite.
