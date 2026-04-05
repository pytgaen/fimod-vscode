---
on peut faire le preview et demander une validation pour remplacer
---

sur le fichier
/home/gaetan/prj_dev/opensrc/fimod/fimod-vscode/tests-data/a.csv
je manipule le csv et c'est pas hyper pratique

on peut faire un modif pour faire un simple
c["c3"]
au lieu de
"[r['c3'] for r in data]"

dans la logique si je suis sur un csv dans logique je sort du lines ou pas ou sinon ça devrait marcher ça :
fimod s -i a.csv -e "[ [r['c3'],1] for r in data]" --input-format csv --output-format csv --csv-no-output-header ─╯
Error: CSV output: each row must be an object

ou si on est sur un array c'est du no header ....
c'est
