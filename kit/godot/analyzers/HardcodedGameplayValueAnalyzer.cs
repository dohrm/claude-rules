using System;
using System.Collections.Immutable;
using System.Linq;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Diagnostics;

namespace Factory.Godot.Analyzers
{
    /// <summary>
    /// GODOT001 — numeric literals inside a Godot type are (probably) gameplay values that
    /// belong in a .tres. Not sound by construction (syntax can't prove "this number is a design
    /// parameter"), but far tighter than grep: it respects the type system, skips const/enum/
    /// attribute contexts and the trivial 0/1, and honours an explicit [TechnicalConstant] opt-out.
    /// See rules/godot-csharp/data.md.
    /// </summary>
    [DiagnosticAnalyzer(LanguageNames.CSharp)]
    public sealed class HardcodedGameplayValueAnalyzer : DiagnosticAnalyzer
    {
        public const string DiagnosticId = "GODOT001";

        private static readonly DiagnosticDescriptor Rule = new DiagnosticDescriptor(
            DiagnosticId,
            title: "Hardcoded gameplay value",
            messageFormat: "Numeric literal '{0}' in a Godot type — move gameplay values to a .tres, or mark the member [TechnicalConstant] if it is a technical constant",
            category: "Design",
            defaultSeverity: DiagnosticSeverity.Warning,
            isEnabledByDefault: true,
            description: "Gameplay parameters must live in .tres resources (rules/godot-csharp/data.md).");

        public override ImmutableArray<DiagnosticDescriptor> SupportedDiagnostics => ImmutableArray.Create(Rule);

        public override void Initialize(AnalysisContext context)
        {
            context.ConfigureGeneratedCodeAnalysis(GeneratedCodeAnalysisFlags.None);
            context.EnableConcurrentExecution();
            context.RegisterSyntaxNodeAction(Analyze, SyntaxKind.NumericLiteralExpression);
        }

        private static void Analyze(SyntaxNodeAnalysisContext context)
        {
            var literal = (LiteralExpressionSyntax)context.Node;

            // Skip the trivial technical values (0, 1) regardless of numeric type suffix.
            if (literal.Token.Value is IConvertible conv)
            {
                try
                {
                    var d = conv.ToDouble(null);
                    if (d == 0.0 || d == 1.0) return;
                }
                catch (Exception) { /* not convertible — fall through and report */ }
            }

            // Only inside a type deriving from a Godot type.
            var typeDecl = literal.FirstAncestorOrSelf<TypeDeclarationSyntax>();
            if (typeDecl is null) return;
            if (context.SemanticModel.GetDeclaredSymbol(typeDecl) is not INamedTypeSymbol typeSymbol) return;
            if (!DerivesFromGodot(typeSymbol)) return;

            // Contextual exclusions.
            foreach (var ancestor in literal.Ancestors())
            {
                switch (ancestor)
                {
                    case EnumDeclarationSyntax _:
                    case AttributeSyntax _:
                        return;
                    case FieldDeclarationSyntax field when field.Modifiers.Any(m => m.IsKind(SyntaxKind.ConstKeyword)):
                        return;
                    case LocalDeclarationStatementSyntax local when local.Modifiers.Any(m => m.IsKind(SyntaxKind.ConstKeyword)):
                        return;
                    case MemberDeclarationSyntax member when HasTechnicalConstant(member):
                        return;
                }
            }

            context.ReportDiagnostic(Diagnostic.Create(Rule, literal.GetLocation(), literal.Token.Text));
        }

        private static bool DerivesFromGodot(INamedTypeSymbol type)
        {
            for (INamedTypeSymbol? t = type; t is not null; t = t.BaseType)
            {
                var ns = t.ContainingNamespace?.ToDisplayString();
                if (ns == "Godot" || (ns != null && ns.StartsWith("Godot.", StringComparison.Ordinal)))
                    return true;
            }
            return false;
        }

        private static bool HasTechnicalConstant(MemberDeclarationSyntax member) =>
            member.AttributeLists
                .SelectMany(l => l.Attributes)
                .Any(a => a.Name.ToString().Contains("TechnicalConstant"));
    }
}
