# Image Text Wrap fixture

This note exercises every case in the build brief. It has three images (one taller than 800 pixels), long paragraphs, a heading, a nested list, a quote, a callout, a table, a code block, display math, an image inside a table, the same image embedded twice, and enough filler to scroll.

![[landscape.png|wrap-left|300]]
A painter rented the cottage by the slipway one summer and stayed for twenty years. The harbour wall was rebuilt three times in the last century, each time a little higher than the storm before it. There is a bakery near the church that opens at six and is usually sold out of bread by ten. A local saying holds that a red sky at noon means the kettle should go on early. Most gardens grow potatoes, runner beans, and at least one plant that nobody remembers planting. In autumn the bracken on the headland turns the colour of rust, and walkers come from miles away. In winter the ferry runs twice a week, and the post arrives in a single canvas bag that smells faintly of diesel. The library is a single room above the post office, with a reading chair that faces the sea. In the evening the lamps along the quay come on one by one, starting from the lifeboat station.

Rain here rarely falls straight down; it arrives sideways, carried in off the water. A narrow path runs along the cliff top, and in spring it is lined with thrift and sea campion. Every August the town holds a regatta, and the winning crew is allowed to ring the harbour bell. The pub keeps a chalkboard of the day's catch and a second chalkboard of the day's gossip. On clear nights the lighthouse beam sweeps across the bedroom ceilings of the whole lower town. Fishing boats leave before dawn and come back when the tide turns, which is rarely the same hour two days running.

## A heading beside a wrapped image

![[tall.png|A tall picture|wrap-right|260]]
When the fog comes in it arrives all at once, as if someone had drawn a curtain across the bay. The school has eleven pupils this year, which is the most it has had in a generation. The tide tables are pinned to the door of every shop, and they are consulted more often than the clock. Nobody locks their bicycles, though everybody locks their sheds, for reasons that are never explained. Children learn to read the weather from the colour of the water long before they learn it at school.

- A list item that sits beside the tall image.
	- A nested item, one level in.
		- A nested item, two levels in, long enough to wrap onto a second line beside the picture.
	- Back to the first level of nesting.
- The last top-level item.

> A quote that should keep its bar visible next to the image. Some of the stone walls in the fields are older than any written record of the village. The bus to the market town takes an hour and stops wherever someone happens to be waiting.

> [!note] A callout
> The callout background should not be covered by the image. The church clock runs four minutes fast, and the town has quietly agreed to keep it that way. The lighthouse keeper kept a log of every ship that passed, written in a neat hand that never seemed to change.

---

Gulls nest on the roof of the fish market and are fed, against all advice, by almost everyone. Visitors often ask about the shipwreck, and the answer changes depending on who is telling it. The ferry captain claims to know every rock in the bay by name, and nobody has ever proved him wrong. Most of the houses on the hill were painted by the same family, and you can still tell which decade by the shade of blue.

| Place | Picture |
| --- | --- |
| Harbour | ![[square.png\|60]] |
| Lighthouse | Text only |

```js
// A code block that should narrow beside a wrapped image or sit below it.
function tide(hour) {
	return Math.sin((hour / 12.42) * Math.PI * 2);
}
```

$$
h(t) = A \sin\left(\frac{2\pi t}{T}\right) + h_0
$$

## The same image twice

![[square.png|wrap-left|180]]
The old chapel now holds a small museum of nets, floats, and photographs of people nobody can quite name. At low tide you can walk out to the island, but only if you watch the time and the water closely. A painter rented the cottage by the slipway one summer and stayed for twenty years. The harbour wall was rebuilt three times in the last century, each time a little higher than the storm before it. There is a bakery near the church that opens at six and is usually sold out of bread by ten. A local saying holds that a red sky at noon means the kettle should go on early.

![[square.png|180]]
Most gardens grow potatoes, runner beans, and at least one plant that nobody remembers planting. In autumn the bracken on the headland turns the colour of rust, and walkers come from miles away. In winter the ferry runs twice a week, and the post arrives in a single canvas bag that smells faintly of diesel. The library is a single room above the post office, with a reading chair that faces the sea.

## Top and bottom

![[landscape.png|wrap-block|360]]
In the evening the lamps along the quay come on one by one, starting from the lifeboat station. Rain here rarely falls straight down; it arrives sideways, carried in off the water. A narrow path runs along the cliff top, and in spring it is lined with thrift and sea campion.

## A remote-style image

![teal|wrap-right|120](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAAN0lEQVR4nO3OMREAMAgEMEQgm7l664JnyF0EpPrNKRUfCAkJCaUHQkJCQumBkJCQUHogJCS07ANd10Rqp5a4wgAAAABJRU5ErkJggg==)
Every August the town holds a regatta, and the winning crew is allowed to ring the harbour bell. The pub keeps a chalkboard of the day's catch and a second chalkboard of the day's gossip. On clear nights the lighthouse beam sweeps across the bedroom ceilings of the whole lower town. Fishing boats leave before dawn and come back when the tide turns, which is rarely the same hour two days running. When the fog comes in it arrives all at once, as if someone had drawn a curtain across the bay.

## A transcluded note

![[Transcluded source]]

## Filler

The harbour wall was rebuilt three times in the last century, each time a little higher than the storm before it. There is a bakery near the church that opens at six and is usually sold out of bread by ten. A local saying holds that a red sky at noon means the kettle should go on early. Most gardens grow potatoes, runner beans, and at least one plant that nobody remembers planting. In autumn the bracken on the headland turns the colour of rust, and walkers come from miles away.

In winter the ferry runs twice a week, and the post arrives in a single canvas bag that smells faintly of diesel. The library is a single room above the post office, with a reading chair that faces the sea. In the evening the lamps along the quay come on one by one, starting from the lifeboat station. Rain here rarely falls straight down; it arrives sideways, carried in off the water. A narrow path runs along the cliff top, and in spring it is lined with thrift and sea campion. Every August the town holds a regatta, and the winning crew is allowed to ring the harbour bell.

The pub keeps a chalkboard of the day's catch and a second chalkboard of the day's gossip. On clear nights the lighthouse beam sweeps across the bedroom ceilings of the whole lower town. Fishing boats leave before dawn and come back when the tide turns, which is rarely the same hour two days running. When the fog comes in it arrives all at once, as if someone had drawn a curtain across the bay. The school has eleven pupils this year, which is the most it has had in a generation. The tide tables are pinned to the door of every shop, and they are consulted more often than the clock. Nobody locks their bicycles, though everybody locks their sheds, for reasons that are never explained.

Children learn to read the weather from the colour of the water long before they learn it at school. Some of the stone walls in the fields are older than any written record of the village. The bus to the market town takes an hour and stops wherever someone happens to be waiting. The church clock runs four minutes fast, and the town has quietly agreed to keep it that way. The lighthouse keeper kept a log of every ship that passed, written in a neat hand that never seemed to change.

Gulls nest on the roof of the fish market and are fed, against all advice, by almost everyone. Visitors often ask about the shipwreck, and the answer changes depending on who is telling it. The ferry captain claims to know every rock in the bay by name, and nobody has ever proved him wrong. Most of the houses on the hill were painted by the same family, and you can still tell which decade by the shade of blue. The old chapel now holds a small museum of nets, floats, and photographs of people nobody can quite name. At low tide you can walk out to the island, but only if you watch the time and the water closely.

A painter rented the cottage by the slipway one summer and stayed for twenty years. The harbour wall was rebuilt three times in the last century, each time a little higher than the storm before it. There is a bakery near the church that opens at six and is usually sold out of bread by ten. A local saying holds that a red sky at noon means the kettle should go on early. Most gardens grow potatoes, runner beans, and at least one plant that nobody remembers planting. In autumn the bracken on the headland turns the colour of rust, and walkers come from miles away. In winter the ferry runs twice a week, and the post arrives in a single canvas bag that smells faintly of diesel.

The library is a single room above the post office, with a reading chair that faces the sea. In the evening the lamps along the quay come on one by one, starting from the lifeboat station. Rain here rarely falls straight down; it arrives sideways, carried in off the water. A narrow path runs along the cliff top, and in spring it is lined with thrift and sea campion. Every August the town holds a regatta, and the winning crew is allowed to ring the harbour bell.

The pub keeps a chalkboard of the day's catch and a second chalkboard of the day's gossip. On clear nights the lighthouse beam sweeps across the bedroom ceilings of the whole lower town. Fishing boats leave before dawn and come back when the tide turns, which is rarely the same hour two days running. When the fog comes in it arrives all at once, as if someone had drawn a curtain across the bay. The school has eleven pupils this year, which is the most it has had in a generation. The tide tables are pinned to the door of every shop, and they are consulted more often than the clock.

Nobody locks their bicycles, though everybody locks their sheds, for reasons that are never explained. Children learn to read the weather from the colour of the water long before they learn it at school. Some of the stone walls in the fields are older than any written record of the village. The bus to the market town takes an hour and stops wherever someone happens to be waiting. The church clock runs four minutes fast, and the town has quietly agreed to keep it that way. The lighthouse keeper kept a log of every ship that passed, written in a neat hand that never seemed to change. Gulls nest on the roof of the fish market and are fed, against all advice, by almost everyone.

Visitors often ask about the shipwreck, and the answer changes depending on who is telling it. The ferry captain claims to know every rock in the bay by name, and nobody has ever proved him wrong. Most of the houses on the hill were painted by the same family, and you can still tell which decade by the shade of blue. The old chapel now holds a small museum of nets, floats, and photographs of people nobody can quite name. At low tide you can walk out to the island, but only if you watch the time and the water closely.

A painter rented the cottage by the slipway one summer and stayed for twenty years. The harbour wall was rebuilt three times in the last century, each time a little higher than the storm before it. There is a bakery near the church that opens at six and is usually sold out of bread by ten. A local saying holds that a red sky at noon means the kettle should go on early. Most gardens grow potatoes, runner beans, and at least one plant that nobody remembers planting. In autumn the bracken on the headland turns the colour of rust, and walkers come from miles away.

In winter the ferry runs twice a week, and the post arrives in a single canvas bag that smells faintly of diesel. The library is a single room above the post office, with a reading chair that faces the sea. In the evening the lamps along the quay come on one by one, starting from the lifeboat station. Rain here rarely falls straight down; it arrives sideways, carried in off the water. A narrow path runs along the cliff top, and in spring it is lined with thrift and sea campion. Every August the town holds a regatta, and the winning crew is allowed to ring the harbour bell. The pub keeps a chalkboard of the day's catch and a second chalkboard of the day's gossip.

On clear nights the lighthouse beam sweeps across the bedroom ceilings of the whole lower town. Fishing boats leave before dawn and come back when the tide turns, which is rarely the same hour two days running. When the fog comes in it arrives all at once, as if someone had drawn a curtain across the bay. The school has eleven pupils this year, which is the most it has had in a generation. The tide tables are pinned to the door of every shop, and they are consulted more often than the clock.

Nobody locks their bicycles, though everybody locks their sheds, for reasons that are never explained. Children learn to read the weather from the colour of the water long before they learn it at school. Some of the stone walls in the fields are older than any written record of the village. The bus to the market town takes an hour and stops wherever someone happens to be waiting. The church clock runs four minutes fast, and the town has quietly agreed to keep it that way. The lighthouse keeper kept a log of every ship that passed, written in a neat hand that never seemed to change.

Gulls nest on the roof of the fish market and are fed, against all advice, by almost everyone. Visitors often ask about the shipwreck, and the answer changes depending on who is telling it. The ferry captain claims to know every rock in the bay by name, and nobody has ever proved him wrong. Most of the houses on the hill were painted by the same family, and you can still tell which decade by the shade of blue. The old chapel now holds a small museum of nets, floats, and photographs of people nobody can quite name. At low tide you can walk out to the island, but only if you watch the time and the water closely. A painter rented the cottage by the slipway one summer and stayed for twenty years.

The harbour wall was rebuilt three times in the last century, each time a little higher than the storm before it. There is a bakery near the church that opens at six and is usually sold out of bread by ten. A local saying holds that a red sky at noon means the kettle should go on early. Most gardens grow potatoes, runner beans, and at least one plant that nobody remembers planting. In autumn the bracken on the headland turns the colour of rust, and walkers come from miles away.

In winter the ferry runs twice a week, and the post arrives in a single canvas bag that smells faintly of diesel. The library is a single room above the post office, with a reading chair that faces the sea. In the evening the lamps along the quay come on one by one, starting from the lifeboat station. Rain here rarely falls straight down; it arrives sideways, carried in off the water. A narrow path runs along the cliff top, and in spring it is lined with thrift and sea campion. Every August the town holds a regatta, and the winning crew is allowed to ring the harbour bell.

The pub keeps a chalkboard of the day's catch and a second chalkboard of the day's gossip. On clear nights the lighthouse beam sweeps across the bedroom ceilings of the whole lower town. Fishing boats leave before dawn and come back when the tide turns, which is rarely the same hour two days running. When the fog comes in it arrives all at once, as if someone had drawn a curtain across the bay. The school has eleven pupils this year, which is the most it has had in a generation. The tide tables are pinned to the door of every shop, and they are consulted more often than the clock. Nobody locks their bicycles, though everybody locks their sheds, for reasons that are never explained.

Children learn to read the weather from the colour of the water long before they learn it at school. Some of the stone walls in the fields are older than any written record of the village. The bus to the market town takes an hour and stops wherever someone happens to be waiting. The church clock runs four minutes fast, and the town has quietly agreed to keep it that way. The lighthouse keeper kept a log of every ship that passed, written in a neat hand that never seemed to change.

Gulls nest on the roof of the fish market and are fed, against all advice, by almost everyone. Visitors often ask about the shipwreck, and the answer changes depending on who is telling it. The ferry captain claims to know every rock in the bay by name, and nobody has ever proved him wrong. Most of the houses on the hill were painted by the same family, and you can still tell which decade by the shade of blue. The old chapel now holds a small museum of nets, floats, and photographs of people nobody can quite name. At low tide you can walk out to the island, but only if you watch the time and the water closely.

A painter rented the cottage by the slipway one summer and stayed for twenty years. The harbour wall was rebuilt three times in the last century, each time a little higher than the storm before it. There is a bakery near the church that opens at six and is usually sold out of bread by ten. A local saying holds that a red sky at noon means the kettle should go on early. Most gardens grow potatoes, runner beans, and at least one plant that nobody remembers planting. In autumn the bracken on the headland turns the colour of rust, and walkers come from miles away. In winter the ferry runs twice a week, and the post arrives in a single canvas bag that smells faintly of diesel.

The library is a single room above the post office, with a reading chair that faces the sea. In the evening the lamps along the quay come on one by one, starting from the lifeboat station. Rain here rarely falls straight down; it arrives sideways, carried in off the water. A narrow path runs along the cliff top, and in spring it is lined with thrift and sea campion. Every August the town holds a regatta, and the winning crew is allowed to ring the harbour bell.

The pub keeps a chalkboard of the day's catch and a second chalkboard of the day's gossip. On clear nights the lighthouse beam sweeps across the bedroom ceilings of the whole lower town. Fishing boats leave before dawn and come back when the tide turns, which is rarely the same hour two days running. When the fog comes in it arrives all at once, as if someone had drawn a curtain across the bay. The school has eleven pupils this year, which is the most it has had in a generation. The tide tables are pinned to the door of every shop, and they are consulted more often than the clock.

Nobody locks their bicycles, though everybody locks their sheds, for reasons that are never explained. Children learn to read the weather from the colour of the water long before they learn it at school. Some of the stone walls in the fields are older than any written record of the village. The bus to the market town takes an hour and stops wherever someone happens to be waiting. The church clock runs four minutes fast, and the town has quietly agreed to keep it that way. The lighthouse keeper kept a log of every ship that passed, written in a neat hand that never seemed to change. Gulls nest on the roof of the fish market and are fed, against all advice, by almost everyone.

Visitors often ask about the shipwreck, and the answer changes depending on who is telling it. The ferry captain claims to know every rock in the bay by name, and nobody has ever proved him wrong. Most of the houses on the hill were painted by the same family, and you can still tell which decade by the shade of blue. The old chapel now holds a small museum of nets, floats, and photographs of people nobody can quite name. At low tide you can walk out to the island, but only if you watch the time and the water closely.
