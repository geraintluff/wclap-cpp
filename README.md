# CLAP API as JSON

For a few WCLAP helpers, I wanted a representation of all the CLAP structures, including sizes/alignment/offsets.

This repo contains a JSON representation of that, for both 32/64-bit.  There's a Node.js script in `dev/` which reads the C `.h` files and updates the JSON representations.  This isn't done with a proper C parser, but some simpler logic.  When updating to a new CLAP revision, you should manually review these changes.

The type names are simplified (e.g. `_t` suffixes removed) and aliases/typedefs resolved.
