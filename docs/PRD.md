# PRD — Première version utilisable de l’intégration Linear / Paperclip

Version documentaire : 0.3 · 9 octobre 2026 · Europe/Paris.

**Statut : cadrage révisé pour une livraison progressive.** La demande de
simplification du 9 octobre remplace l’obligation de livrer toute l’autonomie de
la v0.2 d’un seul tenant. Cette version fixe une V1 bornée et identifie les
comportements reportés. Elle ne prouve aucune capacité installée ou activée.
Elle n’autorise aucune implémentation, activation ou écriture sur des tickets réels.
Le [TAD proposé](TAD.md) en décrit la réalisation ; les
[vérifications restantes](TAD-QUESTIONS.md) portent sur cette V1 seulement.

## 1. Résultat recherché

Depuis Linear, l’utilisateur engage une milestone préparée. Paperclip/Council
réalise ses livraisons dans l’ordre, publie les résultats utiles dans Linear et
ne clôt le ticket de campagne qu’après vérification de toute la milestone.
L’utilisateur intervient lorsqu’un choix ou un incident dépasse le parcours
prévu ; la V1 n’a pas à résoudre automatiquement tous ces cas.

Un agent sans historique du chat retrouve dans Linear et ses références durables
l’objectif, le périmètre engagé, le plan, les résultats, les preuves et la suite.
Les budgets, runs et détails d’exécution restent dans Paperclip. Une PR ouverte,
un run réussi ou un statut Done seul ne signifie pas que le travail est livré.

Le premier parcours à rendre utilisable est une milestone d’un dépôt, préparée
et sans travail déjà engagé, avec au moins deux livraisons successives. Le
parcours Todo ponctuel existant conserve son contrat historique ; son extension
aux cas supplémentaires n’est pas un prérequis de cette première livraison.

## 2. Périmètre de la V1

| Inclus | Limite choisie |
| --- | --- |
| Engagement depuis Linear | Un ticket de campagne dédié, hors de la milestone mais dans son projet, référence son identifiant exact et les versions validées du PRD/TAD. Une transition Todo par un acteur configuré demande l’engagement. Une date cible ou un label seul ne suffit pas. |
| Milestone préparée | Objectifs et critères transversaux dans sa description ; tickets, critères et dépendances renseignés avant engagement. Les prérequis nécessaires sont déjà disponibles ou inclus. |
| Préparation au démarrage | Après réception du Todo, lecture complète, contrôle des conditions et publication du plan avant le premier travail. Pas de préparation automatique en Backlog ni de seconde confirmation si tout est valide. |
| Une campagne par dépôt | Une seule campagne active, suspendue ou en réconciliation par dépôt dans l’instance configurée. Un engagement recouvrant est retenu et expliqué ; aucune file de campagnes à construire. |
| Périmètre fixé | Membres, critères, dépendances et références sont fixés à l’engagement. Une modification matérielle observée suspend la campagne ; pas d’analyse d’impact automatique en V1. |
| Livraisons sérielles | Une PR par feuille de code, revue indépendante, contrôles, fusion et vérification intégrée avant la suivante. Le parent ne reçoit pas de PR artificielle. |
| Suivi Linear | Commentaires aux étapes significatives, liens vers PR/preuves et statuts convenus. Aucune réécriture des descriptions humaines, des objectifs ou des relations. |
| Arrêt et reprise | Commandes dans Paperclip ; arrêt au prochain point sûr, conservation des résultats et reprise explicite après vérification. Linear reste le point d’engagement initial et de suivi. |
| Clôture globale | Bilan de couverture des critères, vérifié par un reviewer Council indépendant. Le ticket de campagne reste ouvert jusqu’au résultat complet et à sa publication vérifiée. |

La mise en service initiale vise un projet Linear, un projet Paperclip et un
dépôt identifiés. Étendre cette configuration à d’autres projets ne nécessite
pas de changer le produit, mais n’est pas une condition de réussite du pilote.
Les autres admissions Council vers le même dépôt respectent la même exclusion :
une campagne milestone ne doit pas concurrencer un ticket déjà lancé.

## 3. Rôles et surfaces

| Acteur | Responsabilité |
| --- | --- |
| Humain | Préparer et engager dans Linear ; traiter les blocages, pauses, reprises et annulations dans Paperclip. |
| Intégration Linear | Lire, importer, publier les effets autorisés et vérifier leur résultat. Elle n’affecte pas seule les agents et ne les réveille pas directement. |
| Council avec Paperclip | Posséder la campagne, le mandat, le budget, la livraison courante, les contrôles et les verdicts ; réutiliser les agents et mécanismes natifs. |
| Reviewer indépendant | Examiner les livraisons puis leur couverture globale, en réutilisant les preuves valides. Aucun comité supplémentaire obligatoire. |

Le plan et le bilan sont des **commentaires publiés par l’intégration**, rattachés
au ticket de campagne et identifiés par campagne et étape. Un lien vers la
campagne Paperclip permet de retrouver les détails. Il n’y a pas de plan concurrent
à éditer manuellement dans une section partagée de description.

Chaque commentaire significatif indique résultat ou blocage, prochaine action et
références utiles. Le bilan final reprend objectif, versions, livraisons et matrice
critère → vérification → résultat → preuve. Les commentaires techniques à chaque
sous-étape sont exclus. Aucune nouvelle console, aucun canal Slack.

Le mandat Paperclip définit dépôt, chemins, budget et permissions. Un événement
Linear ne crée aucun droit et ne remet aucun compteur à zéro. Les deux accès
lecture et publication restent limités ; la révocation de l’écriture ne doit pas
supprimer la possibilité de lire et de diagnostiquer.

## 4. Parcours nominal et exceptions

1. L’humain prépare la milestone et son ticket de campagne, puis passe ce ticket
   à Todo. Les descriptions restent sous son contrôle.
2. L’intégration retient la demande et lit les sources complètes. Council vérifie
   le mandat, l’absence d’occupation du dépôt et l’éligibilité. Le plan est publié
   et relu avant l’implémentation. Un doublon retrouve la même demande.
3. Paperclip exécute une livraison. Après revue indépendante, contrôles, fusion et
   vérification intégrée, l’intégration en publie le résultat puis la suivante
   peut commencer. Les corrections habituelles avant fusion restent dans le mandat.
4. Lorsque toutes les livraisons et obligations propres des parents/milestone sont
   satisfaites, le lead prépare le bilan. Le reviewer global vérifie sa couverture
   sans refaire automatiquement toutes les revues de PR.
5. Le bilan favorable et les statuts terminaux sont publiés puis relus. La campagne
   n’est déclarée terminée qu’après cette confirmation.

| Situation hors parcours nominal | Réponse attendue en V1 |
| --- | --- |
| Dépôt occupé ou ticket déjà engagé | Retenir la demande, donner le propriétaire courant et demander une reprise explicite après libération. Pas d’absorption ni de second départ. |
| Périmètre ou critère modifié | Suspendre dès observation ; montrer la différence. L’humain peut rétablir le périmètre engagé, ou arrêter la campagne et préparer un nouvel engagement. Pas d’adoption automatique des changements. |
| Prérequis manquant ou dépendance externe non prouvée | Bloquer et expliquer le besoin. L’humain prépare les tickets nécessaires ; la V1 ne les crée ni ne les engage automatiquement. |
| Statut Linear humain incompatible | Signaler l’écart et retenir les effets dépendants jusqu’à clarification dans Paperclip. Pas de boucle de correction automatique des statuts humains. Un Done manuel ne clôt jamais la campagne interne. |
| Panne Linear, écriture refusée ou réponse perdue | Conserver l’opération locale déjà engagée jusqu’à un point sûr ; aucun nouveau travail, fusion ou clôture. Relire et réconcilier avant reprise, sans double effet. |
| Pause | Demande dans Paperclip ; aucun nouveau départ ni fusion après observation. L’opération déjà envoyée est réconciliée sous son identité initiale. |
| Annulation | Arrêter le reste dans Paperclip, conserver livraisons intégrées et historique. Signaler les PR ouvertes à fermer manuellement ; aucun nettoyage automatique ni succès global. |
| Échec après fusion ou base inattendue | Suspendre les nouvelles livraisons. L’humain décide du rétablissement ; pas de choix autonome correction/revert. Reprendre seulement avec base et preuves vérifiées. |

Une campagne annulée libère le dépôt seulement après arrêt et réconciliation des
effets envoyés. Le bilan d’annulation liste les résultats conservés et le travail
restant ; ses PR encore ouvertes ne sont pas réutilisées implicitement. Une
nouvelle campagne requiert un nouvel engagement explicite et une éligibilité
complète, sans réexécuter aveuglément des résultats historiques.

L’utilisateur voit dans Paperclip l’état réel si la publication Linear est en
attente. Les demandes ultérieures de pause/reprise/annulation depuis les statuts
Linear ne sont pas prises en charge en V1 ; un changement inattendu est signalé
comme écart, avec le lien vers les commandes Paperclip.

Un arbitrage conserve dans Paperclip sa question, son auteur, sa réponse et ses
conséquences. Sa publication Linear est vérifiée avant la reprise dépendante.
Un engagement retenu pour dépôt occupé n’est pas une file automatique : l’opérateur
relance sa vérification explicitement, en conservant l’identité de la demande.

## 5. Exigences de la V1

Les IDs M01–M10 désignent ce périmètre. Les anciennes exigences R01–R17 et
scénarios V01–V18 restent consultables dans la v0.2 via Git ; ils ne sont pas tous
des prérequis de livraison de la V1.

| ID | Exigence vérifiable |
| --- | --- |
| M01 | Le ticket de campagne et ses références permettent de retrouver objectif, périmètre, versions, plan, résultat, preuves et prochaine action sans chat antérieur. |
| M02 | Une transition autorisée engage une milestone exacte ; source incomplète, périmètre ambigu, dépôt occupé et événements répétés ne produisent ni faux démarrage ni doublon. |
| M03 | Toute exécution passe par Paperclip/Council dans le mandat et le budget existants. Une seule campagne peut travailler sur le dépôt configuré. |
| M04 | Chaque livraison de code reçoit sa PR, sa revue indépendante, ses contrôles et sa vérification après fusion avant le départ de la suivante. |
| M05 | Plan, étapes importantes, blocages et bilan sont publiés sans réécrire les descriptions humaines. Les effets de statut restent bornés et les publications sont relues. |
| M06 | Un changement matériel ou un cas reporté produit un arrêt récupérable avec action humaine explicite ; il n’élargit jamais silencieusement le travail. |
| M07 | Doublon, interruption et réponse perdue préservent identités, résultats et budget. Un effet incertain n’est pas recréé sous une autre clé. |
| M08 | Pause, reprise et annulation dans Paperclip respectent les points sûrs ; l’annulation conserve les résultats et ne vaut jamais réussite. |
| M09 | Le bilan couvre feuilles, obligations propres des parents et critères transversaux. Un reviewer indépendant donne un verdict global ; le ticket reste ouvert tant que critères, preuves ou publication finale manquent. |
| M10 | Configuration désactivée par défaut, permissions limitées, références de secrets uniquement et absence d’adoption automatique des anciens travaux. Installation et qualification ne valent pas activation. |

## 6. Ce qui est reporté et pourquoi

| Évolution ultérieure | Coût évité pour la V1 | Comportement présent |
| --- | --- | --- |
| Adaptation automatique des membres, critères et versions | Analyse sémantique, invalidation ciblée et replanification | Périmètre fixé, suspension expliquée. |
| Absorption d’un ticket déjà engagé | Transfert concurrent de propriété, preuves et comptabilité | Engagement recouvrant retenu. |
| Création automatique de prérequis | Qualification de nécessité, créations et nouvelles dépendances | Intervention humaine. |
| Plusieurs campagnes actives sur le même dépôt | File de fusion concurrente et coordination entre campagnes | Une occupation durable par dépôt. |
| Modification des descriptions et correction des statuts humains | Écritures partagées, arbitrage concurrent et boucles de synchronisation | Commentaires séparés et signalement des écarts. |
| Commandes complètes depuis Linear et préparation en Backlog | Historique de commandes, attribution et états supplémentaires | Todo initial ; commandes suivantes dans Paperclip. |
| Correction/revert autonome après fusion et nettoyage des PR annulées | Décisions et effets de récupération supplémentaires | Arrêt, diagnostic et intervention humaine. |
| Couverture de toute topologie et dépendances entre campagnes | Multiplication des cas de coordination | Milestone préparée, sans travail déjà engagé ni dépendance externe non prouvée. |

Ces évolutions sont des candidates, sans ordre imposé ni engagement de réalisation.
Elles seront choisies à partir des blocages et usages observés sur la V1. La
fiabilité du parcours livré reste obligatoire : « stabiliser plus tard » ne
signifie ni perdre du travail, ni déclarer un succès sans preuve.

### Décisions du cadrage précédent

| Décisions v0.2 | Disposition pour cette révision |
| --- | --- |
| D01–D02 | Conservées : exécution Paperclip et versions produit/TAD identifiées. |
| D03 | Engagement milestone conservé ; Todo ponctuel existant reste dans son périmètre historique. |
| D04 | Réduite : prérequis préparés avant engagement ; pas d’engagement automatique supplémentaire. |
| D05–D06 | Conservées : livraison intégrée, obligations globales et revue indépendante. |
| D07 | Réduite : série dans la campagne et une seule campagne active par dépôt. |
| D08 | Réduite : détection et suspension ; analyse d’impact ciblée reportée. |
| D09–D10 | Conservées : arrêt en panne, arbitrages Paperclip et publication avant reprise dépendante. |
| D11–D14 | Conservées dans le pilote : PR par feuille, plugin séparé, un dépôt par campagne, Slack exclu. |
| D15–D16 | Reportées : adaptation automatique et correction automatique d’un statut humain. |
| D17 | Conservée avec commandes Paperclip ; contrôle via Linear reporté. |
| D18–D19 | Reportées : absorption et création/engagement automatique de prérequis. |
| D20 | Réduite : arrêt et rétablissement humain ; correction/revert autonome reporté. |
| D21 | Réduite : arrêt, réconciliation et conservation ; fermeture des PR manuelle. |

Cette disposition et le passage du plan en commentaires remplacent les choix
correspondants du grill et du draft TAD v0.1. La demande de simplification est
l’autorité de cette révision ; les anciennes décisions ne doivent pas réapparaître
comme obligations cachées dans les lots d’implémentation.

## 7. Validation proportionnée et sortie V1

| Scénario | Observation attendue | Exigences |
| --- | --- | --- |
| A01 — Milestone nominale | Deux livraisons successives, PR distinctes, revues, fusions, vérifications intégrées, suivi Linear et bilan global ; reprise du contexte par un agent neuf. | M01, M03, M04, M05, M09 |
| A02 — Entrée refusée ou répétée | Mauvais acteur, source incomplète, dépôt occupé ou signal répété : aucune admission indue ni seconde campagne. | M02, M03, M10 |
| A03 — Redémarrage et réponse perdue | Reprise de la même identité ; commentaire, import ou fusion incertaine recherché avant toute nouvelle tentative. | M05, M07 |
| A04 — Source ou état humain modifié | Arrêt expliqué, descriptions intactes, aucune adaptation silencieuse ni faux Done. | M05, M06, M09 |
| A05 — Pause, annulation et reprise | Commande Paperclip honorée, aucun nouveau départ après observation, effets envoyés réconciliés, résultats conservés. | M07, M08 |
| A06 — Panne ou incident intégré | Pas de livraison suivante pendant panne Linear, publication inconnue ou échec après fusion ; reprise explicite après vérification. | M04, M06, M07 |
| A07 — Clôture prématurée | Enfants seuls terminés, critère transversal manquant ou bilan non publié : campagne non terminée. | M09 |
| A08 — Mise en service bornée | Installation sans activation, anciens travaux inchangés ; révocation d’écriture conservant le diagnostic en lecture. | M02, M05, M10 |

Les règles et erreurs se vérifient avec des tests synthétiques ciblés. Un parcours
représentatif doit aussi démontrer les effets natifs Paperclip, les écritures et
relectures Linear, l’exécution des agents et les fusions réellement revendiquées,
sur un périmètre de test autorisé. Une lecture seule ne prouve jamais une écriture.
Il n’est pas nécessaire de répéter tous les tests avec un fournisseur réel.

La V1 est utilisable lorsque A01 fonctionne de bout en bout et que les refus et
reprises A02–A08 sont démontrés aux couches concernées. Une démonstration limitée à
l’import ou à l’admission n’est pas la V1. La lisibilité du suivi est vérifiée sur
ce parcours ; il n’y a ni engagement de délai à la minute, ni programme UX séparé.
Les améliorations de cadence, de volume et d’ergonomie viendront des usages.

## 8. Sources et état existant

Sources de cette révision : PRD v0.2 fusionné dans `5b5255c`, draft TAD v0.1
fourni par l’utilisateur et demande explicite de simplification du 9 octobre.
La révision porte uniquement sur des documents ; elle ne requalifie aucun runtime.
Les [contrats existants](TODO-INTAKE-CONTRACT.md), le
[handoff Council](COUNCIL-HANDOFF-V1.md) et le
[plan des lots déjà réalisés](IMPLEMENTATION-PLAN.md) gardent leur portée historique.

### Observation historique du PRD v0.2

Le passage ci-dessous est conservé comme observation datée. Ses mentions de la
« cible » décrivent la v0.2 ; les limites V1 des sections précédentes prévalent.

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
