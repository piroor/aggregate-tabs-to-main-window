import globals from "globals";

export default [{
    ignores: ["eslint.config.mjs", "makexpi/*", "submodules/*", "extlib/*", "!**/.eslintrc.js"],
}, {
    languageOptions: {
        globals: {
            ...globals.webextensions,
        },

        ecmaVersion: 2018,
        sourceType: "script",
    },

    rules: {
        indent: ["warn", 2, {
            SwitchCase: 1,
            MemberExpression: 1,

            CallExpression: {
                arguments: "first",
            },

            VariableDeclarator: {
                var: 2,
                let: 2,
                const: 3,
            },
        }],

        quotes: ["warn", "single", {
            avoidEscape: true,
            allowTemplateLiterals: true,
        }],
    },
}];