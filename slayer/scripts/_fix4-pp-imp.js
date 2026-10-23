window.__imp = async (from, name) => {
  const src = await (await fetch(from)).text();
  const m = src.match(new RegExp(`from\\s+["'](/src/data/${name}\\.ts[^"']*)["']`));
  return import(m ? m[1] : `/src/data/${name}.ts`);
};
