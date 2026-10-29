# Third-party data

This backend can build a compact database derived from
[ECDICT](https://github.com/skywind3000/ECDICT), an English-to-Chinese
dictionary database maintained by Linwei.

ECDICT is licensed under the MIT License. A copy of its license is included at
`dictionary_source/ECDICT-LICENSE`.

The CSV source and generated database are not shipped in this source snapshot.
The generated `data/dictionary.db` contains a filtered subset of ECDICT for
common and exam-related vocabulary. Run `python scripts/build_dictionary.py`
to rebuild it from `dictionary_source/ecdict.csv`.
