namespace Godot
{
    public class Node
    {
        public object GetNode(string path) => this;
        public object GetNodeOrNull(string path) => this;
    }

    [System.AttributeUsage(System.AttributeTargets.Delegate)]
    public sealed class SignalAttribute : System.Attribute
    {
    }
}
