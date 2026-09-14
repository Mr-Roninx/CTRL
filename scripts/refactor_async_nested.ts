import { Project, SyntaxKind, VariableStatement, CallExpression, Node } from 'ts-morph';

const project = new Project();
project.addSourceFilesAtPaths("src/**/*.ts");

const dbFile = project.getSourceFileOrThrow("src/db/database.ts");

console.log("Refactoring nested statements...");
const functions = dbFile.getFunctions();

for (const func of functions) {
  // Find all variable statements inside the function recursively
  const varStatements = func.getDescendantsOfKind(SyntaxKind.VariableStatement);
  
  for (const stmtNode of varStatements) {
    const stmtText = stmtNode.getText();
    if (stmtText.includes("db.prepare")) {
        const varDecl = stmtNode.getFirstDescendantByKind(SyntaxKind.VariableDeclaration);
        if (varDecl) {
            const init = varDecl.getInitializerIfKind(SyntaxKind.CallExpression);
            if (init && init.getExpression().getText() === "db.prepare") {
                const sqlArg = init.getArguments()[0];
                const sqlText = sqlArg.getText();
                const varName = varDecl.getName();
                
                const parentBlock = stmtNode.getParent(); // Should be a Block or SourceFile
                const siblings = parentBlock.getChildren();
                const stmtIndex = siblings.indexOf(stmtNode);
                
                let replacedUsage = false;
                
                for (let j = stmtIndex + 1; j < siblings.length; j++) {
                    const nextStmt = siblings[j];
                    const nextText = nextStmt.getText();
                    
                    if (nextText.includes(`${varName}.get`) || nextText.includes(`${varName}.all`) || nextText.includes(`${varName}.run`)) {
                        let updatedText = nextText;
                        
                        // Handle .get(args)
                        const getRegex = new RegExp(`(?:return\\s+)?${varName}\\.get\\(([^)]*)\\)(?:\\s*as\\s+[^;]+)?;?`, 'g');
                        const getMatch = getRegex.exec(updatedText);
                        if (getMatch) {
                            const args = getMatch[1].trim() ? `[${getMatch[1]}]` : "[]";
                            
                            if (nextStmt.getKind() === SyntaxKind.ReturnStatement) {
                                const asMatch = updatedText.match(/as\s+(.*);/);
                                const cast = asMatch ? ` as ${asMatch[1]}` : '';
                                updatedText = `return (await DatabaseAdapter.getInstance().query(${sqlText}, ${args}))[0]${cast};`;
                            } else {
                                updatedText = updatedText.replace(getRegex, `(await DatabaseAdapter.getInstance().query(${sqlText}, ${args}))[0]`);
                            }
                        }
                        
                        // Handle .all(args)
                        const allRegex = new RegExp(`(?:return\\s+)?${varName}\\.all\\(([^)]*)\\)(?:\\s*as\\s+[^;]+)?;?`, 'g');
                        const allMatch = allRegex.exec(updatedText);
                        if (allMatch) {
                            const args = allMatch[1].trim() ? `[${allMatch[1]}]` : "[]";
                            if (nextStmt.getKind() === SyntaxKind.ReturnStatement) {
                                const asMatch = updatedText.match(/as\s+(.*);/);
                                const cast = asMatch ? ` as ${asMatch[1]}` : '';
                                updatedText = `return (await DatabaseAdapter.getInstance().query(${sqlText}, ${args}))${cast};`;
                            } else {
                                updatedText = updatedText.replace(allRegex, `await DatabaseAdapter.getInstance().query(${sqlText}, ${args})`);
                            }
                        }
                        
                        // Handle .run(args)
                        const runRegex = new RegExp(`${varName}\\.run\\(([^)]*)\\);?`, 'g');
                        const runMatch = runRegex.exec(updatedText);
                        if (runMatch) {
                            const args = runMatch[1].trim() ? `[${runMatch[1]}]` : "[]";
                            updatedText = updatedText.replace(runRegex, `await DatabaseAdapter.getInstance().execute(${sqlText}, ${args});`);
                        }
                        
                        if (nextStmt.getKind() === SyntaxKind.ReturnStatement || nextStmt.getKind() === SyntaxKind.ExpressionStatement || nextStmt.getKind() === SyntaxKind.VariableStatement) {
                           try {
                               // A bit of a hack: some expressions might be nested (like in VariableDeclaration). 
                               // For simplicity, we just replace the whole statement text if it's a top-level statement within the block.
                               (nextStmt as any).replaceWithText(updatedText);
                               replacedUsage = true;
                           } catch (e) {
                               console.log("Could not replace block statement:", updatedText);
                           }
                        }
                    }
                }
                
                if (replacedUsage) {
                    stmtNode.remove();
                }
            }
        }
    }
  }
}

console.log("Saving nested changes...");
project.saveSync();
console.log("Done.");
