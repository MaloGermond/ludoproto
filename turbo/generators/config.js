module.exports = function generator(plop) {
  plop.setGenerator("p5js", {
    description: "Nouveau sketch p5.js (HTML + JS)",
    prompts: [
      {
        type: "input",
        name: "name",
        message: "Nom du sketch (ex: mon-sketch) ?",
      },
    ],
    actions: [
      {
        type: "add",
        path: "{{ turbo.paths.root }}/projects/{{ dashCase name }}/index.html",
        templateFile: "templates/p5js/index.html.hbs",
      },
      {
        type: "add",
        path: "{{ turbo.paths.root }}/projects/{{ dashCase name }}/sketch.js",
        templateFile: "templates/p5js/sketch.js.hbs",
      },
      {
        type: "add",
        path: "{{ turbo.paths.root }}/projects/{{ dashCase name }}/package.json",
        templateFile: "templates/p5js/package.json.hbs",
      },
    ],
  });
};
