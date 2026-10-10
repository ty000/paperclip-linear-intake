# Vérifications techniques restantes — V1 Linear / Paperclip

10 octobre 2026 · Sources : [PRD v0.4](PRD.md), [TAD draft v0.3](TAD.md).

Ce fichier remplace le questionnaire large T01–T13 de la v0.2 du PRD. La demande
de simplification a reporté les cas avancés ; ils ne sont plus des conditions
préalables au premier parcours utilisable. Les anciennes questions restent dans
Git, notamment au commit `5b5255c`.

## Q1 — Peut-on lire le périmètre et l’engagement exacts ?

Vérifier les outils du connecteur géré pour milestone, membres/descendants,
contenus complets, références, dépendances, états et auteur du Todo. Conserver
les contrôles existants de pagination et de portée. Un outil de l’app Linear de
Codex ne prouve pas sa disponibilité dans le gateway Paperclip.

Résultat attendu : une source complète pour une milestone de test préparée, ou
une lacune précise avec son impact sur M01/M02. Ne pas viser une capture atomique
de tout Linear ni un historique générique de commandes.

## Q2 — Peut-on publier sans modifier les descriptions ?

Vérifier ajout/lecture de commentaires, recherche corrélée après réponse perdue,
lecture/écriture des seuls statuts autorisés et révocation de l’écriture conservant
la lecture. Aucune création de ticket, relation ou édition de description requise.

L’inspection read-only qualifie seulement catalogue et lectures. La qualification
d’écriture exige un périmètre de test autorisé et démontre effet, readback et
réconciliation. Une absence de CAS de description ne bloque pas cette V1 ; une
création de commentaire au résultat inconnu ne peut pas être répétée aveuglément.

## Q3 — Quel complément manque à la conduite native ?

Identifier le chemin actuel Council/Paperclip pour une PR par feuille, revue,
fusion, vérification intégrée, arrêt avant nouveau départ et revue globale.
Vérifier que l’occupation durable d’un dépôt couvre aussi les admissions Todo
ponctuelles. Ne pas déduire ce parcours d’une preuve limitée à N1 ou d’une
hiérarchie à candidat commun.

Résultat attendu : réutilisation explicite plus la liste minimale des manques.
Pas de nouvelle file de fusion concurrente, saga de transfert ou moteur d’impact.

## Q4 — Quel pilote démontre la valeur ?

Identifier un projet/dépôt de test, une milestone préparée avec deux livraisons,
un critère transversal, un mandat et des droits de publication bornés. Démontrer
A01 et les refus/reprises essentiels A02–A08 aux couches concernées. Montrer un
arrêt compréhensible pour un cas reporté plutôt que développer son automatisation.

Les métadonnées d’accès manquantes sont cible, société, profil et portée autorisée,
jamais la valeur d’un secret. Sans accès opérationnel autorisé, poursuivre l’étude
statique et les tests isolés disponibles ; ne pas appeler un gateway par déduction.
Ces vérifications ne demandent pas un nouveau cycle prep → prompt → run pour
chaque réponse : les traiter directement dans le prochain lot borné et autorisé.
