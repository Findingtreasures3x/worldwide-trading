// ============================================================
//  INVENTORY — edit this file to update what shows on the site
// ============================================================
//
//  Each category has a "name" and an "items" array.
//  Each item has these fields:
//    name    — card or product name
//    details — set info, exclusivity, etc.
//    price   — displayed as-is, include the $
//    qty     — how many in stock (shows a badge if > 1)
//    brand   — "one-piece" or "pokemon" (used for filtering)
//
//  Save this file, refresh the page, done.
// ============================================================

const INVENTORY = {
  "categories": [
    {
      "name": "Sealed Product",
      "items": [
        {
          "name": "PRB-02 The Best Vol 2 Premium English Booster 10-Box Case",
          "details": "One Piece · Sealed",
          "price": "$3,500",
          "qty": 1,
          "brand": "one-piece"
        },
        {
          "name": "English Version 2nd Anniversary Set",
          "details": "One Piece · Sealed Promotional Bundle",
          "price": "$1,200",
          "qty": 1,
          "brand": "one-piece"
        },
        {
          "name": "Treasure Booster Set",
          "details": "One Piece · Sealed",
          "price": "$175",
          "qty": 10,
          "brand": "one-piece"
        },
        {
          "name": "Blooming Waters Premium Collection",
          "details": "Pokémon · Sealed",
          "price": "$350",
          "qty": 1,
          "brand": "pokemon"
        },
        {
          "name": "Phantasmal Flames Elite Trainer Box",
          "details": "Pokémon · Pokémon Center Exclusive · Sealed",
          "price": "$320",
          "qty": 1,
          "brand": "pokemon"
        },
        {
          "name": "Prismatic Evolutions 2-Pack Trainer Box & Booster Bundle",
          "details": "Pokémon · Costco Exclusive · Sealed",
          "price": "$275",
          "qty": 2,
          "brand": "pokemon"
        },
        {
          "name": "Prismatic Evolutions Lucario ex & Tyranitar ex Premium Collection",
          "details": "Pokémon · Sam's Club Exclusive · Sealed",
          "price": "$190",
          "qty": 2,
          "brand": "pokemon"
        },
        {
          "name": "Prismatic Evolutions Booster Bundle + Surprise Box Bundle",
          "details": "Pokémon · Sam's Club Exclusive · Sealed",
          "price": "$125",
          "qty": 2,
          "brand": "pokemon"
        },
        {
          "name": "Professor Juniper Premium Tournament Collection Box",
          "details": "Pokémon · Sealed",
          "price": "$100",
          "qty": 2,
          "brand": "pokemon"
        },
        {
          "name": "Pokémon Day 2026 Collection",
          "details": "Pokémon · Sealed",
          "price": "$30",
          "qty": 2,
          "brand": "pokemon"
        }
      ]
    }
  ]
};
